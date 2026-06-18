import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Allowlist, PEER_KEY_RE } from "./allowlist.js";
import { loadOrCreateIdentity } from "./identity.js";
import {
  PROTOCOL_VERSION,
  createAuthRequestSurface,
  createAuthResultSurface,
  createSurface,
  createSurfaceProposal,
  shortKey,
  type AuthResultStatus,
  type InboundMessage,
  type InstancePresence,
  type SurfaceEnvelope,
} from "./protocol.js";
import { Transport, type Peer } from "./transport.js";

/**
 * Piper — "sshd for Pi".
 *
 * Loads into a Pi instance and exposes it as an encrypted, key-addressed
 * control surface over HyperDHT. Per-instance keypair identity; manual-pairing
 * allowlist. The wire schema is Pi's own AgentEvent stream, forwarded verbatim.
 */

// Pi agent events forwarded to connected managers, tagged with `type`.
const FORWARDED_EVENTS = [
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
] as const;

// Remote approvals are opt-in for v0 so the extension never blocks a normal
// local session. Enable with PIPER_APPROVALS=remote.
const APPROVALS_ENABLED = (process.env.PIPER_APPROVALS ?? "off") === "remote";
const APPROVAL_TIMEOUT_MS = positiveEnvInt("PIPER_APPROVAL_TIMEOUT_MS", 30_000);
const AUTH_REQUEST_TIMEOUT_MS = 10 * 60_000;
const AUTH_RESULT_STATUSES = new Set<AuthResultStatus>(["completed", "failed", "expired", "cancelled", "rejected"]);
const LOCAL_AUTH_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function positiveEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Delta batching: Pi emits one message_update per token (thinking +
// content). Forwarded verbatim this produces hundreds of NDJSON
// lines per second. We keep the latest state per responseId and flush
// on a timer (DELTA_BATCH_MS) plus on natural breakpoints. Set
// PIPER_DELTA_BATCH_MS=0 to disable.
const DELTA_BATCH_MS = positiveEnvInt("PIPER_DELTA_BATCH_MS", 100);
const FLUSH_ON_EVENTS = new Set([
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "turn_end",
  "agent_end",
]);

/**
 * Optional override for the DHT bootstrap nodes. Defaults to Holepunch's public
 * network. Set PIPER_BOOTSTRAP="host:port,host:port" to use a private bootstrap
 * (self-hosted fleet on a locked-down network, or a local testnet in tests).
 */
function piperDhtOptions(): unknown {
  const raw = process.env.PIPER_BOOTSTRAP;
  if (!raw) return undefined;
  const bootstrap = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((hostPort) => {
      const i = hostPort.lastIndexOf(":");
      return { host: hostPort.slice(0, i), port: Number(hostPort.slice(i + 1)) };
    });
  return { bootstrap };
}

// The factory is async so setup completes before pi starts any
// session. We do all one-time work here (identity, allowlist, DHT
// listener, handler registration) — no `session_start` callback. The
// SDK fires `session_start` only when a runtime mode binds the
// session (print, interactive, rpc), and the SDK use case has no
// mode. Other extensions (email, minimax-provider, browser-use) all
// follow this pattern; Piper is the same. Re-entrancy guard ensures
// a re-load (e.g. /reload) does not re-create the transport.
export default async function piper(pi: ExtensionAPI): Promise<void> {
  const cwd = process.cwd();
  let transport: Transport | undefined;
  let allow: Allowlist | undefined;
  let identityHex = "";
  let streaming = false;
  const label = process.env.PIPER_LABEL ?? hostname();
  const pendingApprovals = new Map<string, { resolve: (decision: "allow" | "block") => void; timer: NodeJS.Timeout }>();
  const pendingAuthRequests = new Map<string, { domain: string; reason: string }>();

  // Delta batching state. We keep the latest message_update per
  // responseId and flush on a timer (DELTA_BATCH_MS) plus on natural
  // breakpoints. The latest event wins because Pi's message object is
  // already cumulative.
  interface PendingDelta { event: unknown; surface: unknown }
  const pendingDeltas = new Map<string, PendingDelta>();
  let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
  function flushPendingDeltas(): void {
    if (deltaFlushTimer) { clearTimeout(deltaFlushTimer); deltaFlushTimer = null; }
    if (pendingDeltas.size === 0) return;
    for (const [, pending] of pendingDeltas) {
      transport?.broadcast({ t: "event", event: pending.event });
      if (pending.surface) broadcastSurface(pending.surface as SurfaceEnvelope);
    }
    pendingDeltas.clear();
  }
  function scheduleDeltaFlush(): void {
    if (DELTA_BATCH_MS === 0) return;
    if (deltaFlushTimer) return;
    deltaFlushTimer = setTimeout(() => {
      deltaFlushTimer = null;
      flushPendingDeltas();
    }, DELTA_BATCH_MS);
  }
  function presence(ctx: any): InstancePresence {
     let model: string | undefined;
    let sessionFile: string | undefined;
    try {
      if (ctx.model) model = `${ctx.model.provider}/${ctx.model.id}`;
    } catch {
      /* best-effort */
    }
    try {
      sessionFile = ctx.sessionManager?.getSessionFile?.() ?? undefined;
    } catch {
      /* best-effort */
    }
    return { publicKey: identityHex, label, cwd: ctx.cwd, model, streaming, sessionFile };
  }

  function statusLine(): string {
    return `Piper ${shortKey(identityHex)} - ${transport?.peerCount() ?? 0} peer(s) - ${allow?.list().length ?? 0} paired`;
  }

  function safeEvent(type: string, event: unknown): unknown {
    try {
      return JSON.parse(JSON.stringify({ type, ...(event as object) }));
    } catch {
      return { type };
    }
  }

  function surfaceSource(ctx: any) {
    let session: string | undefined;
    try {
      session = ctx.sessionManager?.getSessionFile?.() ?? undefined;
    } catch {
      /* best-effort */
    }
    return { harness: "pi", session };
  }

  function surfaceFromEvent(type: string, event: any, ctx: any): SurfaceEnvelope | undefined {
    const source = surfaceSource(ctx);
    switch (type) {
      case "agent_start":
        return createSurface({
          surface: "event",
          type: "task.update",
          id: randomUUID(),
          source,
          summary: "Agent started work",
          payload: { state: "running", label, cwd: ctx.cwd },
          display: { title: "Agent started", subtitle: label, priority: "normal", icon: "play", group: "task" },
        });
      case "agent_end":
        return createSurface({
          surface: "event",
          type: "task.update",
          id: randomUUID(),
          source,
          summary: "Agent finished work",
          payload: { state: "completed", label, cwd: ctx.cwd },
          display: { title: "Agent finished", subtitle: label, priority: "normal", icon: "check", group: "task" },
        });
      case "tool_execution_start": {
        const toolName = String(event?.toolName ?? "unknown");
        return createSurface({
          surface: "action",
          type: "notification",
          id: randomUUID(),
          source,
          summary: `Tool started: ${toolName}`,
          payload: { toolName, args: event?.args ?? {} },
          display: { title: "Tool started", subtitle: toolName, priority: "normal", icon: "wrench", group: "tools" },
        });
      }
      case "tool_execution_end": {
        const toolName = String(event?.toolName ?? "unknown");
        const failed = Boolean(event?.isError);
        return createSurface({
          surface: "event",
          type: "notification",
          id: randomUUID(),
          source,
          summary: `Tool ${failed ? "failed" : "finished"}: ${toolName}`,
          payload: { toolName, isError: failed },
          display: {
            title: failed ? "Tool failed" : "Tool finished",
            subtitle: toolName,
            priority: failed ? "high" : "normal",
            icon: failed ? "alert-triangle" : "check",
            group: "tools",
          },
        });
      }
      default:
        return undefined;
    }
  }

  function broadcastSurface(surface: SurfaceEnvelope): void {
    transport?.broadcast({ t: "surface", surface });
  }

  function resolvePendingApproval(id: string, decision: "allow" | "block"): boolean {
    const pending = pendingApprovals.get(id);
    if (!pending) return false;
    pendingApprovals.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(decision);
    return true;
  }

  function allowAllPendingApprovals(): void {
    for (const id of [...pendingApprovals.keys()]) resolvePendingApproval(id, "allow");
  }

  async function handleInbound(ctx: any, peer: Peer, msg: InboundMessage): Promise<void> {
    const ok = (id?: string, data?: unknown) => id && peer.send({ t: "response", id, ok: true, data });
    const fail = (id: string | undefined, error: string) => id && peer.send({ t: "response", id, ok: false, error });

    switch (msg.t) {
      case "prompt":
        try {
          if (streaming) pi.sendUserMessage(msg.message, { deliverAs: msg.streamingBehavior ?? "steer" });
          else pi.sendUserMessage(msg.message);
          ok(msg.id);
        } catch (e: any) {
          fail(msg.id, String(e?.message ?? e));
        }
        break;

      case "steer":
        try {
          pi.sendUserMessage(msg.message, { deliverAs: "steer" });
          ok(msg.id);
        } catch (e: any) {
          fail(msg.id, String(e?.message ?? e));
        }
        break;

      case "abort":
        try {
          ctx.abort?.();
          ok(msg.id);
        } catch (e: any) {
          fail(msg.id, String(e?.message ?? e));
        }
        break;

      case "get_state":
        ok(msg.id, presence(ctx));
        break;

      case "get_messages": {
        let messages: unknown[] = [];
        try {
          const entries = ctx.sessionManager?.getBranch?.() ?? ctx.sessionManager?.getEntries?.() ?? [];
          messages = entries.filter((e: any) => e?.type === "message").map((e: any) => e.message);
        } catch {
          /* best-effort */
        }
        ok(msg.id, { messages });
        break;
      }

      case "approval_response": {
        resolvePendingApproval(msg.id, msg.decision);
        break;
      }

      case "auth_result": {
        if (!AUTH_RESULT_STATUSES.has(msg.status)) {
          fail(msg.id, `invalid auth result status: ${String(msg.status)}`);
          break;
        }
        const pending = pendingAuthRequests.get(msg.id);
        if (!pending) {
          fail(msg.id, "unknown or expired auth request");
          break;
        }
        pendingAuthRequests.delete(msg.id);
        broadcastSurface(createAuthResultSurface({
          id: randomUUID(),
          requestId: msg.id,
          status: msg.status,
          note: msg.note,
          source: surfaceSource(ctx),
        }));
        ctx.ui?.notify?.(
          `Piper auth ${msg.status} for ${pending.domain}${msg.note ? `: ${msg.note}` : ""}`,
          msg.status === "completed" ? "info" : "warning",
        );
        ok(msg.id);
        break;
      }

      default:
        fail((msg as { id?: string }).id, `unknown message type: ${String((msg as { t?: unknown }).t)}`);
        break;
    }
  }
  // Re-entrancy guard: a /reload would re-run this factory, but the
  // transport is process-global. Skip re-setup if already running.
  if (!transport) {
    const kp = loadOrCreateIdentity(cwd);
    identityHex = kp.publicKey.toString("hex");
    allow = new Allowlist(cwd);
    // Build a minimal ctx so the rest of Piper (callbacks, presence) can
    // call ctx.ui?.X without a runtime UI. The SDK use case has no
    // user-facing UI; CLI mode can pass a real ctx via a future hook.
    const noopCtx = { cwd, ui: undefined, model: undefined, sessionManager: undefined } as { cwd: string; ui: unknown; model: unknown; sessionManager: unknown };
    transport = new Transport(kp, allow, {
      onConnect: (peer) => {
        peer.send({ t: "hello", protocol: PROTOCOL_VERSION, instance: presence(noopCtx) });
      },
      onMessage: (peer, msg) => void handleInbound(noopCtx, peer, msg),
      onDisconnect: () => {
        if ((transport?.peerCount() ?? 0) === 0) allowAllPendingApprovals();
      },
      log: (line) => process.stdout.write(`piper: ${line}\n`),
    }, piperDhtOptions());

    try {
      await transport.listen();
      process.stdout.write(
        `piper: listening\n` +
          `piper:   instance key: ${identityHex}\n` +
          (allow.list().length === 0 ? `piper:   no paired peers yet\n` : ``),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(`piper: failed to listen: ${msg}\n`);
    }
  }

  // Cleanup on session shutdown. Best-effort: the transport itself
  // is process-global, so we do not destroy it; we just clear local refs.
  pi.on("session_shutdown", async () => {
    // intentionally do not destroy transport — it is shared across
    // sessions in the same process. Cleanup is a no-op here. The
    // transport is destroyed on process exit.
  });

  // Transport is process-global and shared across sessions. The no-op
  // handler above is the only session_shutdown handler. Do not add
  // a destructive one — the transport must persist between wakes
  // so peers can connect at any time, not just during a wake.

  // Forward Pi's native event stream to all connected managers, and push a
  // presence update whenever the instance flips between busy and idle so a
  // fleet view can show live status.
  for (const name of FORWARDED_EVENTS) {
    pi.on(name as any, async (event: any, ctx: any) => {
      if (name === "agent_start") streaming = true;
      if (name === "agent_end") {
        streaming = false;
        flushPendingDeltas();
      }
      const surface = surfaceFromEvent(name, event, ctx);
      if (name === "message_update" && DELTA_BATCH_MS > 0) {
        // Buffer by responseId; Pi's message object is already
        // cumulative, so the latest one wins. Surface too, so the
        // surfaceFromEvent call isn't wasted.
        const id = (event?.message?.responseId as string) ?? "__anon__";
        pendingDeltas.set(id, { event: safeEvent(name, event), surface });
        scheduleDeltaFlush();
      } else {
        if (FLUSH_ON_EVENTS.has(name)) flushPendingDeltas();
        transport?.broadcast({ t: "event", event: safeEvent(name, event) });
        if (surface) broadcastSurface(surface);
      }
      if (name === "agent_start" || name === "agent_end") {
        transport?.broadcast({ t: "presence", instance: presence(ctx) });
        ctx.ui?.setStatus?.("piper", statusLine());
      }
    });
  }

  // Keep presence fresh when the active model changes.
  pi.on("model_select" as any, async (_event: any, ctx: any) => {
    transport?.broadcast({ t: "presence", instance: presence(ctx) });
  });

  // Remote permission gate (opt-in). When a manager is connected, ask it before
  // a tool runs; block on explicit denial. Times out to allow so it never hangs.
  if (APPROVALS_ENABLED) {
    pi.on("tool_call", async (event: any) => {
      if (!transport || transport.peerCount() === 0) return; // no remote driver
      const id = randomUUID();
      transport.broadcast({ t: "approval_request", id, toolName: event.toolName, input: event.input });
      broadcastSurface(createSurface({
        surface: "approval",
        type: "approval.request",
        id,
        source: { harness: "pi" },
        summary: `Approval requested: ${String(event.toolName ?? "tool")}`,
        payload: { toolName: String(event.toolName ?? "tool"), input: event.input ?? {} },
        display: {
          title: "Approval requested",
          subtitle: String(event.toolName ?? "tool"),
          priority: "critical",
          icon: "shield-alert",
          group: "approvals",
        },
      }));
      const decision = await new Promise<"allow" | "block">((resolve) => {
        // Fail-open on timeout: if no manager answers within APPROVAL_TIMEOUT_MS
        // the tool runs as if it had been approved locally. This keeps a flaky
        // network from blocking the agent forever. Last-peer-disconnect is also
        // fail-open via onDisconnect -> allowAllPendingApprovals().
        const timer = setTimeout(() => {
          resolvePendingApproval(id, "allow");
        }, APPROVAL_TIMEOUT_MS);
        pendingApprovals.set(id, { resolve, timer });
      });
      if (decision === "block") return { block: true, reason: "Denied by remote Piper operator" };
    });
  }

  pi.registerCommand("piper", {
    description: "Show Piper status (instance key, peers, allowlist)",
    handler: async (_args, ctx) => {
      const keys = allow?.list() ?? [];
      const connected = new Set(transport?.connectedKeys() ?? []);
      const lines = [
        `instance key : ${identityHex}`,
        `label        : ${label}`,
        `listening    : ${transport ? "yes" : "no"}`,
        `peers        : ${transport?.peerCount() ?? 0} connected`,
        `approvals    : ${APPROVALS_ENABLED ? "remote" : "off"}`,
        `allowlist    : ${keys.length} key(s)`,
        ...keys.map((k) => `   - ${k}${connected.has(k) ? " (connected)" : ""}`),
      ];
      ctx.ui?.notify?.(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("piper-allow", {
    description: "Pair a peer: add its public key to the Piper allowlist",
    handler: async (args, ctx) => {
      const key = (args ?? "").trim().toLowerCase();
      if (!PEER_KEY_RE.test(key)) {
        ctx.ui?.notify?.("Usage: /piper-allow <64 hex-char peer key>", "error");
        return;
      }
      const alreadyPaired = allow?.has(key) ?? false;
      allow?.add(key);
      ctx.ui?.setStatus?.("piper", statusLine());
      ctx.ui?.notify?.(
        alreadyPaired ? `Peer ${shortKey(key)} was already paired.` : `Paired peer ${shortKey(key)}. It can now connect.`,
        "info",
      );
    },
  });

  pi.registerCommand("piper-deny", {
    description: "Revoke a peer: remove its public key from the Piper allowlist",
    handler: async (args, ctx) => {
      const key = (args ?? "").trim().toLowerCase();
      if (!PEER_KEY_RE.test(key)) {
        ctx.ui?.notify?.("Usage: /piper-deny <64 hex-char peer key>", "error");
        return;
      }
      const removed = allow?.remove(key) ?? false;
      const disconnected = transport?.disconnectKey(key) ?? 0;
      ctx.ui?.setStatus?.("piper", statusLine());
      ctx.ui?.notify?.(
        removed
          ? `Revoked peer ${shortKey(key)}.${disconnected > 0 ? ` Disconnected ${disconnected} active connection(s).` : ""}`
          : `Peer ${shortKey(key)} was not paired.${disconnected > 0 ? ` Disconnected ${disconnected} active connection(s).` : ""}`,
        removed ? "info" : "warning",
      );
    },
  });

  pi.registerCommand("piper-surface-propose", {
    description: "Propose a typed surface schema: /piper-surface-propose <type> [rationale]",
    handler: async (args, ctx) => {
      const [proposedType, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      if (!proposedType) {
        ctx.ui?.notify?.("Usage: /piper-surface-propose <type> [rationale]", "error");
        return;
      }
      const rationale = rest.join(" ").trim() || "Agent requested richer display for this surface type.";
      const surface = createSurfaceProposal({
        proposedType,
        rationale,
        source: surfaceSource(ctx),
      });
      broadcastSurface(surface);
      ctx.ui?.notify?.(`Piper surface proposal sent: ${proposedType}`, "info");
    },
  });

  pi.registerCommand("piper-auth", {
    description: "Request remote auth handoff: /piper-auth <url> [reason]",
    handler: async (args, ctx) => {
      const [rawUrl, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      if (!rawUrl) {
        ctx.ui?.notify?.("Usage: /piper-auth <https-url> [reason]", "error");
        return;
      }

      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        ctx.ui?.notify?.("Piper auth request needs a valid URL.", "error");
        return;
      }
      if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_AUTH_HOSTS.has(url.hostname))) {
        ctx.ui?.notify?.("Piper auth request requires https, except for localhost development URLs.", "error");
        return;
      }

      const id = randomUUID();
      const reason = rest.join(" ").trim() || "Agent needs user-assisted authentication to continue.";
      const domain = url.hostname;
      pendingAuthRequests.set(id, { domain, reason });
      setTimeout(() => {
        if (!pendingAuthRequests.delete(id)) return;
        broadcastSurface(createAuthResultSurface({
          id: randomUUID(),
          requestId: id,
          status: "expired",
          source: surfaceSource(ctx),
        }));
      }, AUTH_REQUEST_TIMEOUT_MS);

      broadcastSurface(createAuthRequestSurface({
        id,
        mode: "open_url",
        origin: url.toString(),
        domain,
        reason,
        expiresAt: Date.now() + AUTH_REQUEST_TIMEOUT_MS,
        requestedScope: "user-assisted authentication",
        sessionDestination: "agent-browser",
        source: surfaceSource(ctx),
      }));
      ctx.ui?.notify?.(`Piper auth request sent for ${domain} (${id})`, "info");
    },
  });
}
