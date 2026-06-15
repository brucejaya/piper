/**
 * Offline integration test for the Piper transport layer.
 *
 * Spins up a local HyperDHT testnet (no internet, no Pi, no API key) and checks:
 *   1. protocol framing tolerates partial frames, CRLF, malformed JSON, and oversized frames
 *   2. allowlisted peers can connect, get `hello`, send messages, and receive broadcasts
 *   3. revoked peers are disconnected and rejected on reconnect
 *   4. non-allowlisted peers are rejected
 *
 * Run: npx tsx scripts/selftest.ts
 */
import assert from "node:assert";
import { randomBytes } from "node:crypto";
import DHT from "hyperdht";
import createTestnet from "hyperdht/testnet";
import { Allowlist } from "../src/allowlist.js";
import {
  PROTOCOL_VERSION,
  checkProtocolCompatibility,
  createAuthRequestSurface,
  createAuthResultSurface,
  createLineDecoder,
  createSurface,
  createSurfaceProposal,
  encode,
  isSurfaceEnvelope,
  type InboundMessage,
} from "../src/protocol.js";
import { Transport, type Peer } from "../src/transport.js";

// In-memory allowlist (skip disk) by subclassing.
class MemAllowlist extends Allowlist {
  private mem = new Set<string>();
  constructor() {
    super(process.cwd());
  }
  override has(pub: Buffer | string) {
    const hex = typeof pub === "string" ? pub : pub.toString("hex");
    return this.mem.has(hex.toLowerCase());
  }
  override add(pubHex: string) {
    this.mem.add(pubHex.toLowerCase());
  }
  override remove(pubHex: string) {
    return this.mem.delete(pubHex.toLowerCase());
  }
  override list() {
    return [...this.mem].sort();
  }
}

function connectPeer(node: any, serverKey: Buffer, keyPair: any) {
  const socket = node.connect(serverKey, { keyPair });
  const inbox: any[] = [];
  socket.on("error", () => {}); // teardown resets are expected
  socket.on("data", createLineDecoder((m) => inbox.push(m)));
  return { socket, inbox };
}

async function waitFor(cond: () => boolean, ms = 8000, what = "condition") {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function checkProtocolDecoder() {
  const decoded: any[] = [];
  const invalid: string[] = [];
  const decode = createLineDecoder((m) => decoded.push(m), {
    maxFrameBytes: 32,
    onInvalidFrame: (reason) => invalid.push(reason),
  });

  decode('{"t":"get_');
  decode('state","id":"s1"}\r\n');
  decode("{not-json}\n");
  decode("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].t, "get_state");
  assert.deepEqual(invalid, ["malformed_json", "frame_too_large"]);
  assert.deepEqual(checkProtocolCompatibility(PROTOCOL_VERSION), { supported: true });
  assert.equal(checkProtocolCompatibility(PROTOCOL_VERSION + 1).supported, false);
  assert.equal(checkProtocolCompatibility(0).supported, false);
  assert.equal(checkProtocolCompatibility("1").supported, false);

  const surface = createSurface({
    surface: "event",
    type: "task.update",
    id: "surface-1",
    ts: 123,
    summary: "Agent started work",
    payload: { state: "running" },
  });
  assert.equal(isSurfaceEnvelope(surface), true);
  assert.equal(isSurfaceEnvelope({ ...surface, fallback: undefined }), false);
  assert.equal(isSurfaceEnvelope({ ...surface, type: "custom.inventory.low_stock" }), true);
  assert.equal(isSurfaceEnvelope({ ...surface, surface: "custom" }), false);
  assert.equal(surface.fallback, "Agent started work");
  assert.equal(isSurfaceEnvelope(createSurfaceProposal({
    proposedType: "custom.inventory.low_stock",
    rationale: "User wants low-stock alerts",
  })), true);
  assert.equal(isSurfaceEnvelope(createAuthRequestSurface({
    id: "auth-1",
    mode: "open_url",
    origin: "https://example.com/login",
    domain: "example.com",
    reason: "Agent needs user-assisted login",
    expiresAt: 456,
  })), true);
  assert.equal(isSurfaceEnvelope(createAuthResultSurface({
    id: "auth-result-1",
    requestId: "auth-1",
    status: "completed",
  })), true);
  console.log("[ok] protocol decoder handled partial, CRLF, malformed, and oversized frames");
  console.log("[ok] protocol compatibility rejected unsupported versions");
  console.log("[ok] surface envelope helpers validate required fallback fields");
}

async function main() {
  checkProtocolDecoder();

  const testnet = await createTestnet(3);
  const bootstrap = testnet.bootstrap;

  const serverKp = DHT.keyPair(randomBytes(32));
  const goodKp = DHT.keyPair(randomBytes(32));
  const good2Kp = DHT.keyPair(randomBytes(32));
  const badKp = DHT.keyPair(randomBytes(32));

  const allow = new MemAllowlist();
  allow.add(goodKp.publicKey.toString("hex"));
  allow.add(good2Kp.publicKey.toString("hex"));

  const received: { peer: Peer; msg: InboundMessage }[] = [];
  let connects = 0;
  let disconnects = 0;
  let rejects = 0;

  const transport = new Transport(
    serverKp,
    allow,
    {
      onConnect: (peer) => {
        connects++;
        peer.send({ t: "hello", protocol: 1, instance: { publicKey: "test", label: "test", cwd: ".", streaming: false } });
      },
      onMessage: (peer, msg) => received.push({ peer, msg }),
      onDisconnect: () => {
        disconnects++;
      },
      log: (line) => {
        if (line.includes("rejected")) rejects++;
      },
    },
    { bootstrap },
  );
  await transport.listen();

  // --- 1. allowlisted peers connect + send a prompt ---
  const goodNode = new DHT({ bootstrap, keyPair: goodKp });
  const good = connectPeer(goodNode, serverKp.publicKey, goodKp);
  await waitFor(() => good.inbox.some((m) => m.t === "hello"), 8000, "hello");
  console.log("[ok] allowlisted peer connected and received hello");

  const good2Node = new DHT({ bootstrap, keyPair: good2Kp });
  const good2 = connectPeer(good2Node, serverKp.publicKey, good2Kp);
  await waitFor(() => good2.inbox.some((m) => m.t === "hello"), 8000, "second hello");
  assert.equal(transport.peerCount(), 2);
  console.log("[ok] second allowlisted peer connected");

  good.socket.write(encode({ t: "prompt", id: "p1", message: "hello instance" }));
  await waitFor(() => received.some((r) => r.msg.t === "prompt"), 8000, "inbound prompt");
  const got = received.find((r) => r.msg.t === "prompt")!.msg as any;
  assert.equal(got.message, "hello instance");
  console.log("[ok] instance received the peer's prompt message");

  good.socket.write(encode({ t: "auth_result", id: "auth-1", status: "completed", note: "signed in on phone" }));
  await waitFor(() => received.some((r) => r.msg.t === "auth_result"), 8000, "inbound auth result");
  const authResult = received.find((r) => r.msg.t === "auth_result")!.msg as any;
  assert.equal(authResult.status, "completed");
  console.log("[ok] instance received a non-secret auth result message");

  good.socket.write(encode({ t: "future_message", id: "future-1" } as any));
  await waitFor(() => received.some((r) => (r.msg as any).t === "future_message"), 8000, "inbound unknown message");
  console.log("[ok] transport delivered an unknown inbound message for handler-level rejection tests");

  // --- 2. instance -> peer broadcast ---
  transport.broadcast({ t: "event", event: { type: "agent_start" } });
  await waitFor(() => good.inbox.some((m) => m.t === "event"), 8000, "broadcast event");
  await waitFor(() => good2.inbox.some((m) => m.t === "event"), 8000, "broadcast event to second peer");
  console.log("[ok] peers received a broadcast event");

  const surface = createSurface({
    surface: "event",
    type: "task.update",
    id: "surface-broadcast-1",
    summary: "Agent started work",
    payload: { state: "running" },
    display: { title: "Agent started", priority: "normal" },
  });
  transport.broadcast({ t: "surface", surface });
  await waitFor(() => good.inbox.some((m) => m.t === "surface" && m.surface?.type === "task.update"), 8000, "broadcast surface");
  await waitFor(() => good2.inbox.some((m) => m.t === "surface" && m.surface?.type === "task.update"), 8000, "broadcast surface to second peer");
  console.log("[ok] peers received a typed surface broadcast");

  // --- 3. revocation disconnects an active peer and rejects future connects ---
  assert.equal(allow.remove(goodKp.publicKey.toString("hex")), true);
  assert.equal(transport.disconnectKey(goodKp.publicKey.toString("hex")), 1);
  await waitFor(() => transport.peerCount() === 1, 8000, "revoked peer disconnect");
  assert.equal(disconnects, 1);
  connectPeer(goodNode, serverKp.publicKey, goodKp);
  await waitFor(() => rejects >= 1, 8000, "rejection of revoked peer");
  assert.equal(connects, 2, "revoked peer should not reconnect");
  console.log("[ok] revoked peer was disconnected and rejected on reconnect");

  // --- 4. non-allowlisted peer is rejected ---
  const badNode = new DHT({ bootstrap, keyPair: badKp });
  connectPeer(badNode, serverKp.publicKey, badKp);
  await waitFor(() => rejects >= 2, 8000, "rejection of un-paired peer");
  assert.equal(connects, 2, "only allowlisted peers should have connected");
  console.log("[ok] non-allowlisted peer was rejected");

  await transport.destroy();
  await goodNode.destroy();
  await good2Node.destroy();
  await badNode.destroy();
  await testnet.destroy();
  console.log("\nALL CHECKS PASSED");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("\nSELFTEST FAILED:", e);
    process.exit(1);
  },
);
