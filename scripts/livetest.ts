/**
 * Full end-to-end live test of the Piper bridge.
 *
 * Exercises the REAL extension (src/index.ts) loaded into a REAL Pi agent
 * session backed by REAL MiniMax, driven by a peer over a local DHT testnet:
 *
 *   peer --prompt--> DHT --> extension --> pi.sendUserMessage --> MiniMax
 *        <--events-- DHT <-- extension <-- agent event stream
 *
 * Requires the isolated agent dir at .pi/agent (auth.json with MiniMax key).
 * Run: npx tsx scripts/livetest.ts
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import DHT from "hyperdht";
import createTestnet from "hyperdht/testnet";
import { AuthStorage, ModelRegistry, SessionManager, DefaultResourceLoader, createAgentSession } from "@earendil-works/pi-coding-agent";
import { createLineDecoder, encode } from "../src/protocol.js";

const PROJECT = process.cwd();
const AGENT_DIR = join(PROJECT, ".pi", "agent");
const PIPER_DIR = join(PROJECT, ".pi", "piper");

process.env.PI_CODING_AGENT_DIR = AGENT_DIR;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function main() {
  // 1. Local DHT testnet so the whole test is deterministic and offline.
  const testnet = await createTestnet(3);
  const bootstrap = testnet.bootstrap as { host: string; port: number }[];
  process.env.PIPER_BOOTSTRAP = bootstrap.map((n) => `${n.host}:${n.port}`).join(",");
  console.log(`testnet bootstrap: ${process.env.PIPER_BOOTSTRAP}`);

  // 2. Peer identity, pre-paired into the instance allowlist before it starts.
  const peerKp = DHT.keyPair(randomBytes(32));
  const peerHex = peerKp.publicKey.toString("hex");
  mkdirSync(PIPER_DIR, { recursive: true });
  writeFileSync(join(PIPER_DIR, "allowed.json"), JSON.stringify([peerHex], null, 2));
  console.log(`paired peer: ${peerHex.slice(0, 12)}…`);

  // 3. Real Pi agent session with the Piper extension discovered from settings.
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = await modelRegistry.getAvailable();
  const model =
    available.find((m: any) => m.provider === "minimax" && m.id === "MiniMax-M3") ??
    available.find((m: any) => m.provider === "minimax");
  if (!model) throw new Error("no MiniMax model available — check .pi/agent/auth.json");
  console.log(`model: ${model.provider}/${model.id}`);

  const resourceLoader = new DefaultResourceLoader({ cwd: PROJECT, agentDir: AGENT_DIR });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: PROJECT,
    agentDir: AGENT_DIR,
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  });

  // Binding extensions is what emits `session_start` (the run modes do this);
  // createAgentSession alone does not. This activates the Piper extension.
  await (session as any).bindExtensions({
    commandContextActions: {
      waitForIdle: () => session.agent.waitForIdle(),
      newSession: async () => ({ cancelled: false }),
      fork: async () => ({ cancelled: false }),
      navigateTree: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      reload: async () => {},
    },
    onError: (err: any) => console.error(`ext error (${err.extensionPath}): ${err.error}`),
  });

  // 4. Wait for the extension to create its identity + announce, then read key.
  const seedPath = join(PIPER_DIR, "seed");
  for (let i = 0; i < 100 && !existsSync(seedPath); i++) await sleep(100);
  if (!existsSync(seedPath)) throw new Error("extension never created its identity seed");
  await sleep(1500); // allow server.listen() to announce on the testnet
  const instanceKp = DHT.keyPair(Buffer.from(readFileSync(seedPath, "utf8").trim(), "hex"));
  const instanceHex = instanceKp.publicKey.toString("hex");
  console.log(`instance key: ${instanceHex.slice(0, 12)}…`);

  // 5. Peer connects over the testnet and drives the agent.
  const peerNode = new DHT({ keyPair: peerKp, bootstrap });
  const socket = peerNode.connect(instanceKp.publicKey, { keyPair: peerKp });

  let gotHello = false;
  let gotMessageUpdate = false;
  let gotAgentEnd = false;
  let assistantText = "";
  const toolNames: string[] = [];
  let sawBusy = false;
  let sawIdle = false;

  socket.on("error", () => {});
  socket.on(
    "data",
    createLineDecoder((raw) => {
      const msg = raw as any;
      if (msg.t === "hello") {
        gotHello = true;
        console.log(`hello from instance: label=${msg.instance.label} model=${msg.instance.model}`);
        socket.write(encode({ t: "prompt", id: randomUUID(), message: "Reply with exactly the token: REMOTE_OK and nothing else." }));
      } else if (msg.t === "presence") {
        if (msg.instance.streaming) sawBusy = true;
        else sawIdle = true;
      } else if (msg.t === "event") {
        const e = msg.event;
        if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
          gotMessageUpdate = true;
          assistantText += e.assistantMessageEvent.delta;
        } else if (e.type === "tool_execution_start") {
          toolNames.push(e.toolName);
        } else if (e.type === "agent_end") {
          gotAgentEnd = true;
        }
      }
    }),
  );

  // 6. Wait for the round trip (MiniMax latency tolerant).
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !(gotAgentEnd && assistantText.length > 0)) await sleep(200);

  console.log("\n--- results ---");
  console.log(`hello received      : ${gotHello}`);
  console.log(`message_update recvd : ${gotMessageUpdate}`);
  console.log(`agent_end received   : ${gotAgentEnd}`);
  console.log(`tools used           : ${toolNames.join(", ") || "(none)"}`);
  console.log(`presence busy/idle   : ${sawBusy}/${sawIdle}`);
  console.log(`assistant text       : ${JSON.stringify(assistantText.trim())}`);

  const pass =
    gotHello && gotMessageUpdate && gotAgentEnd && assistantText.includes("REMOTE_OK") && sawBusy && sawIdle;

  // 7. Cleanup.
  try {
    socket.destroy();
  } catch {}
  await peerNode.destroy();
  session.dispose?.();
  await sleep(500);
  await testnet.destroy();

  if (pass) {
    console.log("\nLIVE TEST PASSED ✓ (peer drove the live agent and received its streamed reply)");
    process.exit(0);
  } else {
    console.error("\nLIVE TEST FAILED ✗");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nLIVE TEST ERROR:", e);
  process.exit(1);
});
