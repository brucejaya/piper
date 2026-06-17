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
  const fromEnv = process.env.PIPER_SEED?.trim();
  if (fromEnv && /^[0-9a-fA-F]{64}$/.test(fromEnv)) {
    const seed = Buffer.from(fromEnv, "hex");
    const kp = DHT.keyPair(seed);
    const pubHex = kp.publicKey.toString("hex");
    process.stdout.write(
      `piper: identity from PIPER_SEED env (public key: ${pubHex})\n`,
    );
    return kp;
  }

  const dir = piperDir(cwd);
  mkdirSync(dir, { recursive: true });
  const seedPath = join(dir, "seed");

  let seed: Buffer;
  if (existsSync(seedPath)) {
    seed = Buffer.from(readFileSync(seedPath, "utf8").trim(), "hex");
  } else {
    seed = randomBytes(32);
    writeFileSync(seedPath, seed.toString("hex"), { mode: 0o600 });
    // First-run notice. The seed is a long-lived private key — anyone who
    // reads it can impersonate this Piper instance. Surface this once so
    // users don't accidentally commit it.
    const pubHex = DHT.keyPair(seed).publicKey.toString("hex");
    process.stdout.write(
      `piper: created identity at ${seedPath}\n` +
        `piper:   public key: ${pubHex}\n` +
        `piper:   add '.pi/piper/' to your .gitignore — the seed is sensitive\n`,
    );
  }
  return DHT.keyPair(seed);
}
