/**
 * Long-lived Piper peer session for an LLM-driven local coding agent.
 *
 * One process per Piper connection. Reads NDJSON request lines from stdin,
 * writes one NDJSON line per outbound event to stdout. Each request must
 * carry a caller-supplied `id`; the matching `response` (ok or error) ends
 * the request. Streaming events (`event`, `presence`, `surface`,
 * `approval_request`, `hello`) are emitted as they arrive. Session lifecycle
 * state is reported as its own `session` envelope.
 *
 * Run: npx tsx scripts/peer-session.ts <instance-key>
 *
 * Request line: any valid InboundMessage from src/protocol.ts, with `id` set.
 * Output line: OutboundMessage | SessionEvent, framed as JSON. Caller
 * discriminates by `t`.
 */
import { createInterface } from "node:readline";
import DHT from "hyperdht";
import {
  checkProtocolCompatibility,
  createLineDecoder,
  encode,
  type InboundMessage,
  type OutboundMessage,
  type ProtocolCompatibility,
} from "../src/protocol.js";
import { bootstrapOpt, loadPeerIdentity } from "../test-peer/cli.js";

type SessionState = "open" | "ready" | "incompatible" | "closed" | "error";

type SessionEvent =
  | { t: "session"; state: "open"; peerKey: string }
  | { t: "session"; state: "ready"; hello: OutboundMessage & { t: "hello" } }
  | { t: "session"; state: "incompatible"; reason: string }
  | { t: "session"; state: "closed" }
  | { t: "session"; state: "error"; reason: string };

type SessionLine = OutboundMessage | SessionEvent;

const target = (process.argv[2] ?? "").trim();
if (!/^[0-9a-f]{64}$/i.test(target)) {
  process.stderr.write("usage: peer-session.ts <64-hex instance-key>\n");
  process.exit(2);
}

const kp = loadPeerIdentity();
const myKey = kp.publicKey.toString("hex");
const node = new DHT({ keyPair: kp, ...bootstrapOpt() });
const socket = node.connect(Buffer.from(target, "hex"), { keyPair: kp });

let opened = false;
const pending = new Map<string, (msg: OutboundMessage) => void>();

const emit = (line: SessionLine): void => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

const failPending = (reason: string): void => {
  for (const [id, resolve] of pending) {
    resolve({ t: "response", id, ok: false, error: reason });
  }
  pending.clear();
};

socket.on("open", () => {
  opened = true;
  emit({ t: "session", state: "open", peerKey: myKey });
});

socket.on("data", createLineDecoder((raw) => {
  const msg = raw as OutboundMessage;
  switch (msg.t) {
    case "hello": {
      const compat: ProtocolCompatibility = checkProtocolCompatibility(msg.protocol);
      if (!compat.supported) {
        emit({ t: "session", state: "incompatible", reason: compat.reason ?? "incompatible" });
        socket.destroy();
        return;
      }
      emit({ t: "session", state: "ready", hello: msg });
      return;
    }
    case "response": {
      emit(msg);
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg);
      }
      return;
    }
    case "approval_request": {
      if (process.env.PIPER_AUTO_APPROVE === "1") {
        socket.write(encode({ t: "approval_response", id: msg.id, decision: "allow" }));
      }
      emit(msg);
      return;
    }
    default:
      emit(msg);
      return;
  }
}));

socket.on("error", (e: unknown) => {
  const reason = e instanceof Error ? e.message : String(e);
  emit({ t: "session", state: "error", reason });
});

socket.on("close", async () => {
  failPending("connection closed");
  emit({ t: "session", state: "closed" });
  try {
    await node.destroy();
  } catch {
    /* ignore */
  }
  if (!opened) process.exitCode = 1;
  process.exit();
});

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;

  if (text === "/quit" || text === "/exit") {
    socket.destroy();
    return;
  }

  let request: InboundMessage;
  try {
    request = JSON.parse(text) as InboundMessage;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    emit({ t: "session", state: "error", reason: `bad request json: ${reason}` });
    return;
  }
  if (!request.id) {
    emit({ t: "session", state: "error", reason: "request requires caller-supplied id" });
    return;
  }

  if (pending.has(request.id)) {
    emit({ t: "session", state: "error", reason: `duplicate request id: ${request.id}` });
    return;
  }

  pending.set(request.id, (response) => {
    if (response.t !== "response") return;
  });
  socket.write(encode(request));
});

rl.on("close", () => {
  socket.destroy();
});
