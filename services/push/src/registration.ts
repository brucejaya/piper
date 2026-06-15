import { createHash, randomUUID } from "node:crypto";

export interface PushRegistration {
  id: string;
  agent: string;
  peerKey: string;
  deviceTokenHash: string;
  platform: "ios";
  createdAt: number;
  revokedAt?: number;
}

export interface PushRegistrationInput {
  agent: string;
  peerKey: string;
  deviceToken: string;
  platform?: "ios";
  now?: number;
}

const HEX_64_RE = /^[a-f0-9]{64}$/i;

export class PushRegistrationStore {
  private registrations = new Map<string, PushRegistration>();

  register(input: PushRegistrationInput): PushRegistration {
    validateRegistrationInput(input);
    const deviceTokenHash = hashDeviceToken(input.deviceToken);
    const existing = [...this.registrations.values()].find(
      (registration) =>
        registration.agent === input.agent &&
        registration.peerKey === input.peerKey.toLowerCase() &&
        registration.deviceTokenHash === deviceTokenHash &&
        registration.revokedAt === undefined,
    );
    if (existing) return existing;

    const registration: PushRegistration = {
      id: randomUUID(),
      agent: input.agent,
      peerKey: input.peerKey.toLowerCase(),
      deviceTokenHash,
      platform: input.platform ?? "ios",
      createdAt: input.now ?? Date.now(),
    };
    this.registrations.set(registration.id, registration);
    return registration;
  }

  activeForAgent(agent: string): PushRegistration[] {
    return [...this.registrations.values()]
      .filter((registration) => registration.agent === agent && registration.revokedAt === undefined)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  revoke(id: string, now = Date.now()): boolean {
    const registration = this.registrations.get(id);
    if (!registration || registration.revokedAt !== undefined) return false;
    registration.revokedAt = now;
    return true;
  }

  revokePeer(agent: string, peerKey: string, now = Date.now()): number {
    const normalizedPeerKey = normalizePeerKey(peerKey);
    let count = 0;
    for (const registration of this.registrations.values()) {
      if (registration.agent === agent && registration.peerKey === normalizedPeerKey && registration.revokedAt === undefined) {
        registration.revokedAt = now;
        count++;
      }
    }
    return count;
  }
}

export function hashDeviceToken(deviceToken: string): string {
  if (deviceToken.trim().length < 16) {
    throw new Error("device token is too short");
  }
  return createHash("sha256").update(deviceToken.trim(), "utf8").digest("hex");
}

function validateRegistrationInput(input: PushRegistrationInput): void {
  if (input.platform && input.platform !== "ios") throw new Error("only ios registrations are supported");
  if (input.agent.length < 6 || input.agent.length > 80) throw new Error("agent must be a short non-secret identifier");
  normalizePeerKey(input.peerKey);
  hashDeviceToken(input.deviceToken);
}

function normalizePeerKey(peerKey: string): string {
  if (!HEX_64_RE.test(peerKey)) throw new Error("peer key must be 64 hex characters");
  return peerKey.toLowerCase();
}
