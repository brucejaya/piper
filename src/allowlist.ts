import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { piperDir } from "./identity.js";

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
      const arr = JSON.parse(readFileSync(this.path, "utf8")) as string[];
      this.keys = new Set(arr.map((k) => k.toLowerCase()));
    } catch {
      // Corrupt allowlist: fail closed (empty), leave the file for the user to inspect.
    }
  }

  has(pub: Buffer | string): boolean {
    const hex = typeof pub === "string" ? pub : pub.toString("hex");
    return this.keys.has(hex.toLowerCase());
  }

  add(pubHex: string): void {
    this.keys.add(pubHex.toLowerCase());
    this.save();
  }

  remove(pubHex: string): boolean {
    const removed = this.keys.delete(pubHex.toLowerCase());
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
