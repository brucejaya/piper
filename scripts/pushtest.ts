import assert from "node:assert";
import {
  MAX_PUSH_WAKE_PAYLOAD_BYTES,
  createPushWakePayload,
  validatePushWakePayload,
} from "../services/push/src/payload.js";

function checkPushWakePayloads() {
  const payload = createPushWakePayload({
    event: "approval",
    agent: "agent-ab12cd",
    ref: "approval-123",
    issuedAt: 1792080000000,
    ttlSeconds: 120,
  });

  assert.deepEqual(validatePushWakePayload(payload), { ok: true });
  assert.ok(Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_PUSH_WAKE_PAYLOAD_BYTES);

  assert.equal(validatePushWakePayload({
    ...payload,
    toolInput: "rm -rf node_modules",
  }).ok, false);

  assert.equal(validatePushWakePayload({
    ...payload,
    transcript: "full agent transcript",
  }).ok, false);

  assert.equal(validatePushWakePayload({
    ...payload,
    ref: "x".repeat(121),
  }).ok, false);

  assert.equal(validatePushWakePayload({
    ...payload,
    ttlSeconds: 7200,
  }).ok, false);

  console.log("[ok] push wake payloads are small, opaque, and content-free");
}

checkPushWakePayloads();
console.log("\nPUSH CHECKS PASSED");
