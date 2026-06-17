// End-to-end test using the real localdht daemon as a separate process.
// Spawns: localdht (real process), fake instance (in-process), peer-session
// child, and the new CLI as `send prompt --stream` to verify the
// streamed-event wire-up. The two subprocesses run independently with their
// own timeouts so a hang in one doesn't block the other.

import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import DHT from "hyperdht";
import { Allowlist } from "../src/allowlist.js";
import { Transport, type Peer } from "../src/transport.js";
import { PROTOCOL_VERSION, type InboundMessage } from "../src/protocol.js";

interface ScenarioResult {
  name: string;
  ok: boolean;
  detail?: string;
}

async function main(): Promise<void> {
  const HOME = "C:/Users/bruce/AppData/Local/Temp/piper-realhome";
  const PEER_HOME = join(HOME, "peer");
  const CLI_HOME = join(HOME, "cli");
  mkdirSync(HOME, { recursive: true });
  mkdirSync(PEER_HOME, { recursive: true });
  mkdirSync(CLI_HOME, { recursive: true });

  const repoRoot = "C:/Users/bruce/documents/misc/code/piper";
  const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const localdhtScript = join(repoRoot, "scripts", "localdht.ts");
  const peerSessionScript = join(repoRoot, "scripts", "peer-session.ts");
  const cliScript = join(repoRoot, "test-peer", "cli.ts");

  // 1. Start the real localdht as a child process.
  const localdht = spawn(process.execPath, [tsxCli, localdhtScript], {
    env: { ...process.env, PIPER_LOCAL_HOME: HOME },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise<void>((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      if (buf.includes("press Ctrl+C")) resolve();
    };
    localdht.stdout.on("data", onData);
    localdht.on("error", reject);
    setTimeout(() => reject(new Error("localdht boot timeout")), 8000);
  });

  const bootstrapLine = readFileSync(join(HOME, "bootstrap"), "utf8").trim();
  const bootstrap = bootstrapLine.split(",").map((hp) => {
    const i = hp.lastIndexOf(":");
    return { host: hp.slice(0, i), port: Number(hp.slice(i + 1)) };
  });
  console.log("[ok] localdht up at", bootstrapLine);

  // 2. Fake instance. Trust-first-peer allowlist; reply to prompt with
  // text_delta + agent_end; reply to get_state.
  const allowDir = mkdtempSync(join(tmpdir(), "piper-allow-"));
  const allow = new Allowlist(allowDir);
  const originalHas = allow.has.bind(allow);
  allow.has = (pub: Buffer | string): boolean => {
    if (originalHas(pub)) return true;
    const hex = (typeof pub === "string" ? pub : pub.toString("hex")).toLowerCase();
    allow.add(hex);
    return true;
  };

  const instanceKp = DHT.keyPair(randomBytes(32));
  const instanceKey = instanceKp.publicKey.toString("hex");
  const instanceLabel = "fake-cloud";

  const transport = new Transport(
    instanceKp,
    allow,
    {
      onConnect: (peer: Peer) => {
        peer.send({
          t: "hello",
          protocol: PROTOCOL_VERSION,
          instance: { publicKey: instanceKey, label: instanceLabel, cwd: ".", streaming: false },
        });
      },
      onMessage: (peer, msg: InboundMessage) => {
        if (msg.t === "prompt" || msg.t === "steer" || msg.t === "abort") {
          if (msg.id) peer.send({ t: "response", id: msg.id, ok: true });
          if (msg.t === "prompt") {
            peer.send({
              t: "event",
              event: {
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "Hello from the cloud" },
              },
            });
            peer.send({ t: "event", event: { type: "agent_end" } });
          }
        } else if (msg.t === "get_state" || msg.t === "get_messages") {
          if (msg.id) peer.send({ t: "response", id: msg.id, ok: true, data: { hello: "world" } });
        }
      },
      onDisconnect: () => {},
      log: () => {},
    },
    { bootstrap },
  );
  await transport.listen();
  console.log("[ok] fake instance up at", instanceKey.slice(0, 12) + "...");

  // 3. Run both scenarios with their own timeouts.
  const results: ScenarioResult[] = [];

  // 3a. peer-session scenario.
  try {
    await withTimeout(runPeerSessionScenario(tsxCli, peerSessionScript, instanceKey, PEER_HOME, bootstrapLine), 15_000);
    results.push({ name: "peer-session", ok: true });
    console.log("[ok] peer-session scenario: prompt + get_state round-trip");
  } catch (e) {
    results.push({ name: "peer-session", ok: false, detail: (e as Error).message });
    console.error(`[err] peer-session scenario failed: ${(e as Error).message}`);
  }

  // 3b. CLI --stream scenario.
  try {
    await withTimeout(runCliStreamScenario(tsxCli, cliScript, instanceKey, CLI_HOME, bootstrapLine), 15_000);
    results.push({ name: "cli --stream", ok: true });
    console.log("[ok] CLI --stream scenario: streamed text_delta event received");
  } catch (e) {
    results.push({ name: "cli --stream", ok: false, detail: (e as Error).message });
    console.error(`[err] CLI --stream scenario failed: ${(e as Error).message}`);
  }

  // 4. Cleanup.
  try { localdht.kill(); } catch { /* ignore */ }
  transport.destroy().catch(() => {});
  rmSync(allowDir, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} scenario(s) failed`);
    process.exit(1);
  }
  console.log("\nALL SCENARIOS PASSED");
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e as Error); },
    );
  });
}

async function runPeerSessionScenario(
  tsxCli: string,
  peerSessionScript: string,
  instanceKey: string,
  peerHome: string,
  bootstrapLine: string,
): Promise<void> {
  const child = spawn(process.execPath, [tsxCli, peerSessionScript, instanceKey], {
    env: { ...process.env, PIPER_PEER_HOME: peerHome, PIPER_BOOTSTRAP: bootstrapLine },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let resolved = 0;
  let buf = "";
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: { t: string; [k: string]: unknown };
      try { msg = JSON.parse(trimmed); } catch { continue; }
      if (msg.t === "session" && msg.state === "ready") {
        child.stdin.write(`${JSON.stringify({ t: "prompt", id: "p1", message: "hello" })}\n`);
      } else if (msg.t === "response" && msg.id === "p1" && msg.ok) {
        resolved++;
        child.stdin.write(`${JSON.stringify({ t: "get_state", id: "s1" })}\n`);
      } else if (msg.t === "response" && msg.id === "s1" && msg.ok) {
        resolved++;
        child.stdin.write("/quit\n");
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[peer stderr] ${chunk}`));
  child.on("exit", () => {
    if (resolved >= 2) resolve();
    else reject(new Error(`only ${resolved} responses`));
  });
  await promise;
}

async function runCliStreamScenario(
  tsxCli: string,
  cliScript: string,
  instanceKey: string,
  cliHome: string,
  bootstrapLine: string,
): Promise<void> {
  const child = spawn(
    process.execPath,
    [tsxCli, cliScript, "--json", "send", "prompt", "--stream", "do thing", instanceKey],
    {
      env: { ...process.env, PIPER_PEER_HOME: cliHome, PIPER_BOOTSTRAP: bootstrapLine },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let gotReady = false;
  let gotEvent = false;
  let buf = "";

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const fail = (reason: string): void => {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    reject(new Error(reason));
  };

  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      let env: { t: string; [k: string]: unknown };
      try { env = JSON.parse(trimmed); } catch { continue; }
      if (env.t === "session" && env.state === "ready") {
        gotReady = true;
        if (!gotReady) return;
      }
      if (env.t === "session" && env.state === "error") {
        fail(`session error: ${env.reason as string}`);
        return;
      }
      if (env.t === "event" && env.event) {
        const inner = env.event as { type?: string; assistantMessageEvent?: { delta?: string } };
        if (inner.type === "message_update" && inner.assistantMessageEvent?.delta === "Hello from the cloud") {
          gotEvent = true;
          // Tell the CLI to exit (human would Ctrl-C).
          try { child.kill("SIGINT"); } catch { /* ignore */ }
        }
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[cli stderr] ${chunk}`));
  child.on("exit", () => {
    if (gotReady && gotEvent) resolve();
    else fail(`gotReady=${gotReady} gotEvent=${gotEvent}`);
  });

  // Belt-and-suspenders: if the CLI doesn't exit on its own within 12s, force-kill.
  setTimeout(() => {
    if (!gotEvent) fail("timed out waiting for streamed event");
  }, 12_000);

  await promise;
}

main().catch((e: unknown) => {
  console.error("[fatal]", e);
  process.exit(1);
});
