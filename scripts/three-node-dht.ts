/**
 * 3-node in-process HyperDHT for Piper smoke testing.
 * Creates a testnet (3 in-process DHT nodes) and writes the bootstrap
 * address to ~/.piper-local-3node/bootstrap. The agent and peer
 * connect to this address and can resolve each other via the 3-node
 * DHT, which supports proper iterative lookups (a single-node DHT
 * does not).
 *
 * Run: npx tsx scripts/three-node-dht.ts
 * Stop: Ctrl+C
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import createTestnet from "hyperdht/testnet";

const HOME = process.env.PIPER_LOCAL_HOME ?? join(homedir(), ".piper-local-3node");
mkdirSync(HOME, { recursive: true });

const testnet = await createTestnet(3);
const bootstrapList = testnet.bootstrap
  .map((b: { host: string; port: number }) => `${b.host}:${b.port}`)
  .join(",");
writeFileSync(join(HOME, "bootstrap"), `${bootstrapList}\n`, { mode: 0o600 });
console.log("piper-3node-dht up");
console.log(`bootstrap: ${bootstrapList}`);
console.log(`bootstrap file: ${join(HOME, "bootstrap")}`);
console.log(`export PIPER_BOOTSTRAP='${bootstrapList}'`);

const stop = async () => {
  try { await testnet.destroy(); } catch { /* ignore */ }
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
