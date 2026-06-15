# App Store Release

This checklist tracks the official paid iOS app release. It excludes promotional website and landing-page work.

## Build Gates

- Generate the Xcode project with `bash scripts/ios-mac-build.sh` on macOS.
- Run iOS unit tests on simulator.
- Confirm the real Piper bridge connects to a local testnet agent.
- Confirm foreground monitoring, prompting, steering, abort, and approval decisions.
- Confirm local agent registry and session history survive app restart and upgrade paths.
- Confirm StoreKit products load for monthly, annual, and lifetime.
- Confirm purchase, restore, failed purchase, and expired subscription states.

## App Store Connect

- Bundle identifier: `app.piper.ios`.
- Products:
  - `app.piper.ios.monthly`
  - `app.piper.ios.annual`
  - `app.piper.ios.lifetime`
- Lifetime must remain prominent in the purchase UI.
- Privacy labels must match `docs/privacy.md`.
- Support contact must route to the support process in `docs/support.md`.

## TestFlight Validation

- Clean first launch.
- Add agent by public key.
- Connect to paired agent.
- View live presence and recent activity.
- Send prompt.
- Send steering message.
- Abort running task.
- Receive approval request.
- Allow and block approval requests.
- Open app from push wake notification and reconnect over Piper.
- Restore purchase on a fresh install.

## Release Principle

The paid app must never imply that payment grants protocol access. Agent control still requires public-key pairing and allowlisting on the agent instance.
