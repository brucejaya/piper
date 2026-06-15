import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredFiles = [
  "apps/ios/project.yml",
  "apps/ios/README.md",
  ".github/workflows/ios.yml",
  "scripts/ios-mac-build.sh",
  "apps/ios/PiperApp/PiperApp.swift",
  "apps/ios/PiperApp/Models/PiperProtocol.swift",
  "apps/ios/PiperApp/Bridge/PiperBridge.swift",
  "apps/ios/PiperApp/Bridge/MockPiperBridge.swift",
  "apps/ios/PiperApp/Identity/PeerIdentityStore.swift",
  "apps/ios/PiperApp/Identity/KeychainPeerIdentityStore.swift",
  "apps/ios/PiperApp/State/AgentStore.swift",
  "apps/ios/PiperApp/Views/AgentDashboardView.swift",
  "apps/ios/PiperApp/Views/SessionView.swift",
  "apps/ios/PiperAppTests/AgentStoreTests.swift",
  "apps/ios/PiperAppTests/PiperProtocolTests.swift",
];

for (const file of requiredFiles) {
  assert.ok(existsSync(join(root, file)), `missing ${file}`);
}

const project = readFileSync(join(root, "apps/ios/project.yml"), "utf8");
assert.match(project, /PiperApp:/);
assert.match(project, /PiperAppTests:/);
assert.match(project, /deploymentTarget:/);

const app = readFileSync(join(root, "apps/ios/PiperApp/PiperApp.swift"), "utf8");
assert.match(app, /KeychainPeerIdentityStore/);

const keychain = readFileSync(join(root, "apps/ios/PiperApp/Identity/KeychainPeerIdentityStore.swift"), "utf8");
assert.match(keychain, /kSecClassGenericPassword/);
assert.match(keychain, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);

const protocol = readFileSync(join(root, "apps/ios/PiperApp/Models/PiperProtocol.swift"), "utf8");
assert.match(protocol, /currentVersion = 1/);
assert.match(protocol, /struct InstancePresence/);
assert.match(protocol, /struct SurfaceEnvelope/);

const bridge = readFileSync(join(root, "apps/ios/PiperApp/Bridge/PiperBridge.swift"), "utf8");
assert.match(bridge, /sendApproval/);
assert.match(bridge, /sendAuthResult/);

console.log("[ok] iOS scaffold files and project spec are present");
console.log("\nIOS SCAFFOLD CHECKS PASSED");
