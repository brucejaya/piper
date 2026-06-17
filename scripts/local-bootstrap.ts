/**
 * Resolves a Piper `PIPER_BOOTSTRAP` value for dev scripts.
 *
 * Order:
 *   1. $PIPER_BOOTSTRAP if set (always wins; lets a one-off test override).
 *   2. PIPER_LOCAL_HOME (default ~/.piper-local)/bootstrap, if present.
 *   3. Empty string (caller falls back to the public DHT).
 *
 * Dev scripts call this once at startup and `process.env.PIPER_BOOTSTRAP =
 * resolveLocalBootstrap()` before they construct any transport. The published
 * Piper package itself never reads this file — it only ever consults
 * $PIPER_BOOTSTRAP, so the runtime contract is unchanged.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveLocalBootstrap(): string {
  const env = process.env.PIPER_BOOTSTRAP;
  if (env) return env;
  const home = process.env.PIPER_LOCAL_HOME ?? join(homedir(), ".piper-local");
  const path = join(home, "bootstrap");
  if (!existsSync(path)) return "";
  const raw = readFileSync(path, "utf8").trim();
  return raw;
}
