import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InboundMessage } from "../src/protocol.js";
import { helpText, interactiveRequest, loadPeerIdentity, parseArgs, peerIdentityDir, requestFor } from "../test-peer/cli.js";

const target = "a".repeat(64);
const tmp = mkdtempSync(join(tmpdir(), "piper-peer-"));
process.env.PIPER_PEER_HOME = tmp;

function expectMessage(value: ReturnType<typeof interactiveRequest>): InboundMessage {
  assert.ok(value && value !== "help" && value !== "quit");
  return value;
}

try {
  assert.equal(peerIdentityDir(), tmp);
  const first = loadPeerIdentity().publicKey.toString("hex");
  const second = loadPeerIdentity().publicKey.toString("hex");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  console.log("[ok] CLI identity persists in configured peer home");

  assert.deepEqual(parseArgs([]), { kind: "print_key" });
  assert.deepEqual(parseArgs([target]), { kind: "interactive", target });
  assert.deepEqual(parseArgs([target, "--state"]), { kind: "state", target });
  assert.deepEqual(parseArgs([target, "--messages"]), { kind: "messages", target });
  assert.deepEqual(parseArgs([target, "--abort"]), { kind: "abort", target });
  assert.deepEqual(parseArgs([target, "--prompt", "hello", "there"]), { kind: "prompt", target, message: "hello there", steer: false });
  assert.deepEqual(parseArgs([target, "--steer", "focus"]), { kind: "prompt", target, message: "focus", steer: true });
  assert.throws(() => parseArgs(["not-a-key"]), /target must be/);
  console.log("[ok] CLI argument parser handles one-shot commands");

  const state = requestFor({ kind: "state", target });
  assert.equal(state.t, "get_state");
  const steer = requestFor({ kind: "prompt", target, message: "focus", steer: true });
  assert.equal(steer.t, "steer");
  console.log("[ok] CLI one-shot request builder maps commands to protocol messages");

  assert.equal(interactiveRequest("/help"), "help");
  assert.equal(interactiveRequest("/quit"), "quit");
  assert.equal(expectMessage(interactiveRequest("/state")).t, "get_state");
  assert.equal(expectMessage(interactiveRequest("/approve approval-1")).t, "approval_response");
  assert.deepEqual(expectMessage(interactiveRequest("/block approval-1 unsafe")), {
    t: "approval_response",
    id: "approval-1",
    decision: "block",
    reason: "unsafe",
  });
  assert.deepEqual(expectMessage(interactiveRequest("/auth-result auth-1 completed signed in")), {
    t: "auth_result",
    id: "auth-1",
    status: "completed",
    note: "signed in",
  });
  assert.equal(expectMessage(interactiveRequest("hello")).t, "prompt");
  assert.match(helpText(), /\/approve <approval-id>/);
  console.log("[ok] CLI interactive commands include approval and auth handoff flows");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("\nCLI CHECKS PASSED");
