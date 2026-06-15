import assert from "node:assert";
import {
  MAX_PUSH_WAKE_PAYLOAD_BYTES,
  createPushWakePayload,
  validatePushWakePayload,
} from "../services/push/src/payload.js";
import { PushRegistrationStore, hashDeviceToken } from "../services/push/src/registration.js";

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

function checkPushRegistrations() {
  const store = new PushRegistrationStore();
  const peerKey = "a".repeat(64);
  const deviceToken = "ios-device-token-abcdef";

  const registration = store.register({
    agent: "agent-ab12cd",
    peerKey,
    deviceToken,
    now: 1792080000000,
  });
  const duplicate = store.register({
    agent: "agent-ab12cd",
    peerKey: peerKey.toUpperCase(),
    deviceToken,
    now: 1792080001000,
  });

  assert.equal(duplicate.id, registration.id);
  assert.equal(registration.peerKey, peerKey);
  assert.equal(registration.deviceTokenHash, hashDeviceToken(deviceToken));
  assert.equal((registration as any).deviceToken, undefined);
  assert.equal(store.activeForAgent("agent-ab12cd").length, 1);
  assert.equal(store.revokePeer("agent-ab12cd", peerKey), 1);
  assert.equal(store.activeForAgent("agent-ab12cd").length, 0);

  assert.throws(() => store.register({
    agent: "agent-ab12cd",
    peerKey: "not-a-key",
    deviceToken,
  }), /peer key/);
  assert.throws(() => hashDeviceToken("short"), /too short/);

  console.log("[ok] push registrations are peer-bound, hashed, idempotent, and revocable");
}

checkPushRegistrations();
console.log("\nPUSH CHECKS PASSED");
