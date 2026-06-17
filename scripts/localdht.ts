/**
 * Long-lived local HyperDHT node for two-local-agents Piper development.
 *
 * Boots a single HyperDHT node, writes its reachable bootstrap address to
 * `~/.piper-local/bootstrap` (overridable via PIPER_LOCAL_HOME), and waits for
 * SIGINT / SIGTERM. Both the Piper instance and the peer CLI read that file
 * (or honour $PIPER_BOOTSTRAP) and connect to the same DHT.
 *
 * Run: npx tsx scripts/localdht.ts
 * Stop: Ctrl+C
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import DHT from "hyperdht";

const HOME = process.env.PIPER_LOCAL_HOME ?? join(homedir(), ".piper-local");
const BOOTSTRAP_PATH = join(HOME, "bootstrap");
const PORT_FILE = join(HOME, "port");
mkdirSync(HOME, { recursive: true });

const port = readPort();
const node = new DHT({ port });

await node.ready();
const addr = node.address();
if (!addr) throw new Error("DHT node has no address");

const host = process.env.PIPER_LOCAL_HOST ?? "127.0.0.1";
const line = `${host}:${addr.port}`;
writeFileSync(BOOTSTRAP_PATH, `${line}\n`, { mode: 0o600 });
writeFileSync(PORT_FILE, `${addr.port}\n`, { mode: 0o600 });

console.log(`piper-localdht listening on ${line}`);
console.log(`bootstrap file: ${BOOTSTRAP_PATH}`);
console.log(`export PIPER_BOOTSTRAP=${line}`);
console.log("press Ctrl+C to stop");

const stop = async () => {
  console.log("\nshutting down");
  try {
    await node.destroy();
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function readPort(): number {
  if (existsSync(PORT_FILE)) {
    const raw = readFileSync(PORT_FILE, "utf8").trim();
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 0;
}
