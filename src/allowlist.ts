import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { piperDir } from "./identity.js";

export const PEER_KEY_RE = /^[0-9a-f]{64}$/;

export function normalizePeerKey(pubHex: string): string | undefined {
  const normalized = pubHex.trim().toLowerCase();
  return PEER_KEY_RE.test(normalized) ? normalized : undefined;
}

/**
 * The manual-pairing trust model: an instance only accepts connections from
 * peer public keys explicitly added here. Backed by `.pi/piper/allowed.json`.
 * Mutations take effect immediately for new connections.
 */
export class Allowlist {
  private readonly path: string;
  private keys = new Set<string>();

  constructor(cwd: string) {
    this.path = join(piperDir(cwd), "allowed.json");
    this.load();
  }

  load(): void {
    if (!existsSync(this.path)) return;
    try {
      const arr = JSON.parse(readFileSync(this.path, "utf8"));
      if (!Array.isArray(arr)) {
        this.keys = new Set();
        return;
      }
      this.keys = new Set(arr.map((k) => (typeof k === "string" ? normalizePeerKey(k) : undefined)).filter((k): k is string => !!k));
    } catch {
      // Corrupt allowlist: fail closed (empty), leave the file for the user to inspect.
      this.keys = new Set();
    }
  }

  has(pub: Buffer | string): boolean {
    const hex = typeof pub === "string" ? pub : pub.toString("hex");
    const key = normalizePeerKey(hex);
    return key ? this.keys.has(key) : false;
  }

  add(pubHex: string): void {
    const key = normalizePeerKey(pubHex);
    if (!key) throw new Error("invalid peer key");
    this.keys.add(key);
    this.save();
  }

  remove(pubHex: string): boolean {
    const key = normalizePeerKey(pubHex);
    if (!key) return false;
    const removed = this.keys.delete(key);
    if (removed) this.save();
    return removed;
  }

  list(): string[] {
    return [...this.keys].sort();
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify([...this.keys], null, 2));
  }
}
