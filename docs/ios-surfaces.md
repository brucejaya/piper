# iOS Surface Rendering Contract

## Summary

The iOS app renders Piper typed surfaces as native controls. The protocol supplies meaning, source context, payload, and semantic display hints. The app owns layout, styling, interaction, permissions, and redaction.

## Rendering Rules

- Never render agent-provided HTML, JavaScript, CSS, Swift, or arbitrary component descriptions.
- Always show fallback text for unknown surface types.
- Always preserve source context where available: agent, harness, session, peer, and timestamp.
- Collapse large payloads behind a detail view.
- Treat display priority as a hint, not as notification permission.
- Keep destructive actions, approvals, and auth handoffs behind explicit user gestures.

## Built-In Patterns

- `task.update`: timeline row with state, progress, next action, and blocker detail when present.
- `notification`: compact activity row.
- `approval.request`: approval card or sheet with tool name, summarized input, timeout, allow, and block.
- `git.commit`: commit card with repository, branch, hash, summary, changed file count, and test status.
- `test.result`: verification card with command, status, duration, failures, and log artifact link.
- `artifact.created`: artifact preview row with title, type, size, and safe preview affordance.
- `metric.series`: metric tile or compact chart with label, value, unit, and trend.
- `experiment.log`: experiment card with hypothesis, result, metric summary, and linked artifacts.
- `surface.proposal`: trust decision sheet showing proposed type, sample payload, requested treatment, and risk.
- `auth.request`: high-trust auth handoff sheet showing requester, domain, guarded origin URL open action, scope, destination, expiry, complete, cancel, and reject.
- `auth.result`: audit timeline row showing non-secret completion status.

## Unknown Surface Fallback

Unknown surfaces render as generic cards with:

- Fallback text.
- Type name.
- Source context.
- Timestamp.
- Priority hint if present.
- Optional raw JSON inspection for technical users.

Unknown surfaces must not create buttons, notifications, or privileged UI unless the user approves an associated `surface.proposal`.

## Auth Handoff

The first auth handoff should keep credentials on the user's device. The app may open a system browser or native auth session for an HTTPS target domain, with localhost HTTP allowed only for development, then report non-secret completion metadata. It must not relay passwords, passkeys, one-time codes, cookies, refresh tokens, or bearer tokens to the agent.

Any future browser-session transfer needs a separate security review before implementation.
