# Piper Typed Surfaces

## Summary

Typed surfaces are structured agent updates carried over the normal Piper protocol. They sit above the raw Pi event stream and help clients render agent activity as native UI without accepting arbitrary UI code from agents.

Surfaces are progressive enhancement:

- Clients that understand a surface can render it as a card, row, sheet, metric, or approval view.
- Clients that do not understand it must show `fallback` text and may expose the raw payload for debugging.
- Agents and extensions may propose new surface types, but clients decide whether to trust and elevate them.

## Envelope

Every surface is sent as an instance-to-manager message:

```json
{"t":"surface","surface":{"kind":"surface","surface":"event","type":"task.update","id":"evt-1","ts":1792080000000,"source":{"harness":"pi","session":".pi/session.jsonl"},"schema":{"version":1},"summary":"Agent started work","fallback":"Agent started work","display":{"title":"Agent started","subtitle":"workstation","priority":"normal","icon":"play","group":"task"},"payload":{"state":"running","label":"workstation","cwd":"/repo"}}}
```

Required fields:

- `kind`: always `surface`.
- `surface`: broad category: `event`, `artifact`, `metric`, `action`, `approval`, `proposal`, or `auth`.
- `type`: schema name, such as `task.update` or `auth.request`.
- `id`: stable event id.
- `ts`: Unix timestamp in milliseconds.
- `source`: agent, harness, or session metadata.
- `schema.version`: integer schema version for this surface type.
- `summary`: concise human-readable summary.
- `fallback`: safe text for old or unsupported clients.
- `payload`: structured JSON object.

Optional fields:

- `display.title`
- `display.subtitle`
- `display.priority`: `low`, `normal`, `high`, or `critical`.
- `display.icon`: semantic icon hint. Clients choose their own icon set.
- `display.group`: client-owned grouping hint.

## Boundaries

Surface payloads are data, not UI code. Agents must not send executable UI, HTML, JavaScript, Swift, CSS, or native component definitions. Display hints are semantic only. Clients own layout, styling, interaction, and permission checks.

Surfaces do not grant new trust. A paired peer can see surfaces because it is already paired. Action execution, approval decisions, notification privileges, and auth handoffs require their own consent model.

## Built-In Surface Types

### `task.update`

Use for agent lifecycle or workflow progress.

Suggested payload:

```json
{"state":"running","label":"workstation","cwd":"/repo","progress":0.4,"nextAction":"running tests"}
```

### `notification`

Use for concise structured updates that do not need a richer schema yet.

Suggested payload:

```json
{"toolName":"shell","isError":false}
```

### `approval.request`

Use when a remote user needs to allow or block an action.

Suggested payload:

```json
{"toolName":"bash","input":{"command":"npm test"},"risk":"normal"}
```

This complements the legacy `approval_request` protocol message. Clients should treat approval surfaces as display context; decisions still flow through the approval protocol.

### `git.commit`

Use when an agent creates or reports a commit.

Suggested payload:

```json
{"hash":"abc1234","branch":"codex/typed-agent-surfaces","repository":"Piper","summary":"Add typed surfaces","changedFiles":6,"tests":"passed"}
```

### `test.result`

Use when an agent reports test or verification status.

Suggested payload:

```json
{"command":"npm run selftest","status":"passed","durationMs":4200,"failedTests":[]}
```

### `artifact.created`

Use when an agent creates a file, report, image, recording, or other artifact.

Suggested payload:

```json
{"artifactId":"art-1","title":"Review notes","mimeType":"text/markdown","sizeBytes":4096}
```

### `metric.series`

Use for values that should render as a metric, trend, or compact chart.

Suggested payload:

```json
{"label":"Latency","value":142,"unit":"ms","trend":"down","points":[180,160,142]}
```

### `experiment.log`

Use for research, optimization, or agent experiment traces.

Suggested payload:

```json
{"hypothesis":"Smaller batches improve review quality","runId":"exp-7","result":"supported","metrics":{"passRate":0.92}}
```

### `surface.proposal`

Use when an agent or extension wants richer treatment for a custom surface.

Suggested payload:

```json
{"proposedType":"custom.inventory.low_stock","requestedDisplay":"card","sample":{"sku":"ABC","remaining":3},"rationale":"User wants low-stock alerts"}
```

Proposals are inert until the user approves elevated treatment. Rejected proposals must not alter client behavior.

### `auth.request`

Use when an agent is blocked on user-assisted authentication, MFA, account selection, OAuth consent, or reauthentication.

Suggested payload:

```json
{"mode":"open_url","origin":"https://example.com","domain":"example.com","reason":"Agent needs account access to continue the requested task","expiresAt":1792080300000,"requestedScope":"read account dashboard","sessionDestination":"agent-browser"}
```

Prohibited payloads:

- Raw passwords.
- Passkeys.
- One-time codes.
- Long-lived cookies.
- Refresh tokens.
- Bearer tokens.
- Full credential forms or secrets copied from the user device.

The first implementation should let the user complete auth from their own device and return only non-secret completion status.

### `auth.result`

Use for non-secret completion metadata after an auth handoff.

Suggested payload:

```json
{"requestId":"auth-1","status":"completed","completedAt":1792080120000}
```

Allowed statuses:

- `completed`
- `failed`
- `expired`
- `cancelled`
- `rejected`

## Versioning

Additive payload fields are allowed within the same schema version. Removing fields, changing meaning, or changing required fields requires a schema version bump.

Clients should:

- Ignore unknown fields.
- Show `fallback` for unknown types.
- Treat unsupported actions as inert.
- Avoid assuming a surface is truthful just because it is structured.

Agents and extensions should:

- Prefer built-in types before proposing custom types.
- Keep payloads small.
- Redact secrets.
- Include enough source context for users to understand who is asking and why.
