import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import DHT from "hyperdht";

export interface KeyPair {
  publicKey: Buffer;
  secretKey: Buffer;
}

/** Per-instance Piper state lives under the project's `.pi/piper/` directory. */
export function piperDir(cwd: string): string {
  return join(cwd, ".pi", "piper");
}

/**
 * Load this instance's stable identity, creating it on first run.
 *
 * We persist a 32-byte seed (not the secret key) and derive the keypair
 * deterministically. The public key is the instance's permanent address —
 * share it; pair peers against it.
 */
export function loadOrCreateIdentity(cwd: string): KeyPair {
  const dir = piperDir(cwd);
  mkdirSync(dir, { recursive: true });
  const seedPath = join(dir, "seed");

  let seed: Buffer;
  if (existsSync(seedPath)) {
    seed = Buffer.from(readFileSync(seedPath, "utf8").trim(), "hex");
  } else {
    seed = randomBytes(32);
    writeFileSync(seedPath, seed.toString("hex"), { mode: 0o600 });
  }
  return DHT.keyPair(seed);
}
