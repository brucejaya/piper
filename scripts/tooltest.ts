/**
 * Live test for tool-execution forwarding + remote approvals.
 *
 * With PIPER_APPROVALS=remote, the instance asks the connected peer before each
 * tool runs. This drives a real MiniMax agent (over a local DHT testnet) to use
 * the bash tool twice:
 *   Phase 1 (ALLOW): peer approves -> tool runs -> output forwarded to peer
 *   Phase 2 (BLOCK): peer denies   -> tool is blocked -> command never runs
 *
 * Set PIPER_APPROVAL_TIMEOUT_MS to a small value when manually checking timeout
 * behavior. If the last remote peer disconnects during an approval, Piper
 * resolves the pending approval as allow so the local session does not hang.
 *
 * Run: npx tsx scripts/tooltest.ts
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
process.env.PIPER_APPROVALS = "remote"; // must be set before the extension module loads

const ALLOW_MARKER = "PIPER_TOOL_OK";
const BLOCK_MARKER = "PIPER_BLOCK_RAN";

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

async function main() {
  const testnet = await createTestnet(3);
  const bootstrap = testnet.bootstrap as { host: string; port: number }[];
  process.env.PIPER_BOOTSTRAP = bootstrap.map((n) => `${n.host}:${n.port}`).join(",");

  const peerKp = DHT.keyPair(randomBytes(32));
  mkdirSync(PIPER_DIR, { recursive: true });
  writeFileSync(join(PIPER_DIR, "allowed.json"), JSON.stringify([peerKp.publicKey.toString("hex")], null, 2));

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = await modelRegistry.getAvailable();
  const model =
    available.find((m: any) => m.provider === "minimax" && m.id === "MiniMax-M3") ??
    available.find((m: any) => m.provider === "minimax");
  if (!model) throw new Error("no MiniMax model available");
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

  const seedPath = join(PIPER_DIR, "seed");
  for (let i = 0; i < 100 && !existsSync(seedPath); i++) await sleep(100);
  await sleep(1500);
  const instanceKp = DHT.keyPair(Buffer.from(readFileSync(seedPath, "utf8").trim(), "hex"));

  const peerNode = new DHT({ keyPair: peerKp, bootstrap });
  const socket = peerNode.connect(instanceKp.publicKey, { keyPair: peerKp });

  // Collected signals
  let decision: "allow" | "block" = "allow";
  const approvals: { toolName: string; phase: string }[] = [];
  const toolStarts: string[] = [];
  const toolEndTexts: string[] = [];
  let agentEnds = 0;
  let phase = "allow";

  let socketOpen = false;
  socket.on("open", () => {
    socketOpen = true;
  });
  socket.on("error", () => {});
  socket.on(
    "data",
    createLineDecoder((raw) => {
      const msg = raw as any;
      if (msg.t === "approval_request") {
        approvals.push({ toolName: msg.toolName, phase });
        console.log(`  approval_request: ${msg.toolName} ${JSON.stringify(msg.input)} -> ${decision}`);
        socket.write(encode({ t: "approval_response", id: msg.id, decision }));
      } else if (msg.t === "event") {
        const e = msg.event;
        if (e.type === "tool_execution_start") toolStarts.push(e.toolName);
        else if (e.type === "tool_execution_end") {
          const text = JSON.stringify(e.result ?? "");
          toolEndTexts.push(text);
        } else if (e.type === "agent_end") agentEnds++;
      }
    }),
  );

  const openDeadline = Date.now() + 15_000;
  while (Date.now() < openDeadline && !socketOpen) await sleep(100);
  await sleep(500);

  async function runPhase(name: string, prompt: string, dec: "allow" | "block", waitEnds: number) {
    phase = name;
    decision = dec;
    console.log(`\n[phase: ${name}] decision=${dec}`);
    socket.write(encode({ t: "prompt", id: randomUUID(), message: prompt }));
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline && agentEnds < waitEnds) await sleep(200);
  }

  // Phase 1 — allow a bash command, expect it to run and the output to come back.
  await runPhase(
    "allow",
    `Use the bash tool to run exactly this command: echo ${ALLOW_MARKER}. Then reply with the single word done.`,
    "allow",
    1,
  );

  // Phase 2 — deny a bash command, expect it to be blocked (never executes).
  await runPhase(
    "block",
    `Use the bash tool to run exactly this command: echo ${BLOCK_MARKER}. Then reply with the single word done.`,
    "block",
    2,
  );

  const allowApprovals = approvals.filter((a) => a.phase === "allow" && a.toolName === "bash").length;
  const blockApprovals = approvals.filter((a) => a.phase === "block" && a.toolName === "bash").length;
  const allowOutputSeen = toolEndTexts.some((t) => t.includes(ALLOW_MARKER));
  const blockOutputSeen = toolEndTexts.some((t) => t.includes(BLOCK_MARKER));

  console.log("\n--- results ---");
  console.log(`bash approval asked (allow phase) : ${allowApprovals > 0}`);
  console.log(`tool_execution_start forwarded     : ${toolStarts.includes("bash")}`);
  console.log(`allowed command output received    : ${allowOutputSeen}  (${ALLOW_MARKER})`);
  console.log(`bash approval asked (block phase)  : ${blockApprovals > 0}`);
  console.log(`blocked command did NOT execute    : ${!blockOutputSeen}  (${BLOCK_MARKER})`);

  const pass =
    allowApprovals > 0 && toolStarts.includes("bash") && allowOutputSeen && blockApprovals > 0 && !blockOutputSeen;

  try {
    socket.destroy();
  } catch {}
  await peerNode.destroy();
  session.dispose?.();
  await sleep(500);
  await testnet.destroy();

  if (pass) {
    console.log("\nTOOL + APPROVALS TEST PASSED ✓");
    process.exit(0);
  } else {
    console.error("\nTOOL + APPROVALS TEST FAILED ✗");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nTOOL TEST ERROR:", e);
  process.exit(1);
});
