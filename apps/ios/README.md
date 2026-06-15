# Piper iOS

This directory is the native iOS development scaffold for the paid Piper app.

The repo is currently being prepared on Windows, so the checked-in project is an XcodeGen spec plus Swift source files. Final project generation and simulator validation should happen on a Mac.

From the repo root, run the scaffold sanity check:

```bash
npm run ioscheck
```

## Mac Setup

Install Xcode and XcodeGen:

```bash
brew install xcodegen
```

Generate the Xcode project:

```bash
cd apps/ios
xcodegen generate
open Piper.xcodeproj
```

Run tests:

```bash
xcodebuild test -project Piper.xcodeproj -scheme Piper -destination 'platform=iOS Simulator,name=iPhone 15'
```

## Current Scope

The scaffold includes:

- SwiftUI app shell.
- Agent dashboard placeholder.
- Session placeholder.
- Piper protocol DTOs matching `docs/protocol.md`.
- Bridge abstraction matching `docs/ios-networking-spike.md`.
- Mock bridge for UI/state development before the Bare/Pear-end bridge lands.
- Peer identity store protocol with an in-memory development implementation.

## Next Mac Tasks

1. Generate the Xcode project with XcodeGen.
2. Replace `MemoryPeerIdentityStore` with a Keychain-backed implementation.
3. Add the Bare/Pear-end bridge target or embedded runtime.
4. Connect `PiperBridge` to the real HyperDHT protocol client.
5. Prove simulator connection to a local Piper testnet instance.

Do not build UI-heavy app features on top of a fake network path without either completing the bridge proof or selecting a documented fallback.
