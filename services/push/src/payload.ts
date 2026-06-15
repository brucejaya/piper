export type PushWakeEvent = "approval" | "auth" | "activity" | "presence";

export interface PushWakePayload {
  v: 1;
  event: PushWakeEvent;
  agent: string;
  ref?: string;
  issuedAt: number;
  ttlSeconds: number;
}

export const MAX_PUSH_WAKE_PAYLOAD_BYTES = 512;

const SECRET_FIELD_RE = /(password|passkey|otp|token|cookie|secret|credential|transcript|prompt|input|message|content)/i;

export function createPushWakePayload(input: {
  event: PushWakeEvent;
  agent: string;
  ref?: string;
  issuedAt?: number;
  ttlSeconds?: number;
}): PushWakePayload {
  const payload: PushWakePayload = {
    v: 1,
    event: input.event,
    agent: input.agent,
    issuedAt: input.issuedAt ?? Date.now(),
    ttlSeconds: input.ttlSeconds ?? 300,
  };

  if (input.ref) payload.ref = input.ref;

  const validation = validatePushWakePayload(payload);
  if (!validation.ok) throw new Error(validation.reason);

  return payload;
}

export function validatePushWakePayload(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "payload must be an object" };
  }

  const payload = value as Partial<PushWakePayload> & Record<string, unknown>;
  if (payload.v !== 1) return { ok: false, reason: "unsupported payload version" };
  if (!["approval", "auth", "activity", "presence"].includes(String(payload.event))) {
    return { ok: false, reason: "invalid event type" };
  }
  if (typeof payload.agent !== "string" || payload.agent.length < 6 || payload.agent.length > 80) {
    return { ok: false, reason: "agent must be a short non-secret identifier" };
  }
  if (payload.ref !== undefined && (typeof payload.ref !== "string" || payload.ref.length > 120)) {
    return { ok: false, reason: "ref must be a short opaque identifier" };
  }
  if (typeof payload.issuedAt !== "number" || !Number.isFinite(payload.issuedAt)) {
    return { ok: false, reason: "issuedAt must be a finite number" };
  }
  if (typeof payload.ttlSeconds !== "number" || payload.ttlSeconds < 1 || payload.ttlSeconds > 3600) {
    return { ok: false, reason: "ttlSeconds must be between 1 and 3600" };
  }

  const secretField = findSecretLikeField(payload);
  if (secretField) return { ok: false, reason: `payload contains disallowed field ${secretField}` };

  const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (size > MAX_PUSH_WAKE_PAYLOAD_BYTES) {
    return { ok: false, reason: "payload exceeds wake payload size limit" };
  }

  return { ok: true };
}

function findSecretLikeField(value: unknown, path = "$"): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SECRET_FIELD_RE.test(key)) return childPath;
    const nested = findSecretLikeField(child, childPath);
    if (nested) return nested;
  }

  return undefined;
}
