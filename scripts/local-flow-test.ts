/**
 * End-to-end test of the local two-agent flow.
 *
 * 1. Boots a `hyperdht/testnet` in-process (the "localdht" equivalent).
 * 2. Spins up a fake Piper instance: a `Transport` listening on a fresh key,
 *    with a real `Allowlist` against a temp dir (initially empty, accepts
 *    any first connecting peer by adding it on the fly).
 * 3. Spawns `peer-session` as a child process, pointed at the testnet
 *    bootstrap via PIPER_BOOTSTRAP and PIPER_PEER_HOME.
 * 4. Sends a `prompt`, waits for the matching `response`, sends a
 *    `get_state`, waits for that response, then closes the session.
 *
 * Run: npx tsx scripts/local-flow-test.ts
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import DHT from "hyperdht";
import createTestnet from "hyperdht/testnet";
import { Allowlist } from "../src/allowlist.js";
import { Transport, type Peer } from "../src/transport.js";
import { PROTOCOL_VERSION, type InboundMessage } from "../src/protocol.js";

const allowDir = mkdtempSync(join(tmpdir(), "piper-allow-"));
const allow = new Allowlist(allowDir);
const originalHas = allow.has.bind(allow);
allow.has = (pub: Buffer | string): boolean => {
  if (originalHas(pub)) return true;
  const hex = (typeof pub === "string" ? pub : pub.toString("hex")).toLowerCase();
  allow.add(hex);
  return true;
};

const testnet = await createTestnet(3);
const bootstrap = testnet.bootstrap;

const instanceKp = DHT.keyPair(randomBytes(32));
const received: { peer: Peer; msg: InboundMessage }[] = [];
const instanceKey = instanceKp.publicKey.toString("hex");

const transport = new Transport(
  instanceKp,
  allow,
  {
    onConnect: (peer) => {
      peer.send({
        t: "hello",
        protocol: PROTOCOL_VERSION,
        instance: { publicKey: instanceKey, label: "fake-cloud", cwd: ".", streaming: false },
      });
    },
    onMessage: (peer, msg) => {
      received.push({ peer, msg });
      if (msg.t === "prompt" || msg.t === "steer" || msg.t === "abort") {
        if (msg.id) peer.send({ t: "response", id: msg.id, ok: true });
      } else if (msg.t === "get_state" || msg.t === "get_messages") {
        if (msg.id) peer.send({ t: "response", id: msg.id, ok: true, data: { ok: true } });
      }
    },
    onDisconnect: () => {},
    log: () => {},
  },
  { bootstrap },
);
await transport.listen();

const peerHome = mkdtempSync(join(tmpdir(), "piper-peer-home-"));
const bootstrapList = bootstrap.map((b: { host: string; port: number }) => `${b.host}:${b.port}`).join(",");
const child = spawn(
  process.execPath,
  [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/peer-session.ts", instanceKey],
  {
    env: {
      ...process.env,
      PIPER_PEER_HOME: peerHome,
      PIPER_BOOTSTRAP: bootstrapList,
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);

let resolved = 0;
let sessionClosed = false;

const finish = async (code: 0 | 1): Promise<void> => {
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  await transport.destroy();
  await testnet.destroy();
  rmSync(peerHome, { recursive: true, force: true });
  rmSync(allowDir, { recursive: true, force: true });
  process.exit(code);
};

const tryFinish = (): void => {
  if (resolved >= 2 && sessionClosed) {
    void finish(0);
  }
};

let buf = "";
child.stdout.on("data", (chunk: Buffer) => {
  buf += chunk.toString();
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    onLine(line);
  }
});
child.stderr.on("data", (chunk: Buffer) => {
  process.stderr.write(`[peer-session stderr] ${chunk}`);
});
child.on("exit", () => {
  sessionClosed = true;
  tryFinish();
});

function onLine(line: string): void {
  if (!line.trim()) return;
  let msg: { t: string; [k: string]: unknown };
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.t === "session") {
    const state = msg.state as string;
    if (state === "ready") {
      console.log("[ok] session ready");
      child.stdin.write(`${JSON.stringify({ t: "prompt", id: "p1", message: "do thing" })}\n`);
    } else if (state === "closed") {
      sessionClosed = true;
      tryFinish();
    } else if (state === "error") {
      console.error(`[err] session error: ${msg.reason as string}`);
      void finish(1);
    }
  } else if (msg.t === "response" && msg.id === "p1") {
    if (msg.ok) {
      console.log("[ok] got response for p1");
      resolved++;
      child.stdin.write(`${JSON.stringify({ t: "get_state", id: "s1" })}\n`);
    } else {
      console.error(`[err] p1 response: ${msg.error as string}`);
      void finish(1);
    }
  } else if (msg.t === "response" && msg.id === "s1") {
    if (msg.ok) {
      console.log("[ok] got response for s1");
      resolved++;
      child.stdin.write("/quit\n");
    } else {
      console.error(`[err] s1 response: ${msg.error as string}`);
      void finish(1);
    }
  } else if (msg.t === "event") {
    // ignore forwarded events
  }
}
