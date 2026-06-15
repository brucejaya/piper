import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Allowlist } from "./allowlist.js";
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
const PEER_KEY_RE = /^[0-9a-f]{64}$/;
const AUTH_RESULT_STATUSES = new Set<AuthResultStatus>(["completed", "failed", "expired", "cancelled", "rejected"]);
const LOCAL_AUTH_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function positiveEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

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

export default function piper(pi: ExtensionAPI): void {
  let transport: Transport | undefined;
  let allow: Allowlist | undefined;
  let identityHex = "";
  let streaming = false;
  const label = process.env.PIPER_LABEL ?? hostname();
  const pendingApprovals = new Map<string, { resolve: (decision: "allow" | "block") => void; timer: NodeJS.Timeout }>();
  const pendingAuthRequests = new Map<string, { domain: string; reason: string }>();

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

  pi.on("session_start", async (_event, ctx: any) => {
    if (transport) return; // already running for this process

    const kp = loadOrCreateIdentity(ctx.cwd);
    identityHex = kp.publicKey.toString("hex");
    allow = new Allowlist(ctx.cwd);

    transport = new Transport(kp, allow, {
      onConnect: (peer) => {
        peer.send({ t: "hello", protocol: PROTOCOL_VERSION, instance: presence(ctx) });
        ctx.ui?.setStatus?.("piper", statusLine());
        ctx.ui?.notify?.(`Piper: peer connected ${shortKey(peer.remoteKey)}`, "info");
      },
      onMessage: (peer, msg) => void handleInbound(ctx, peer, msg),
      onDisconnect: (peer) => {
        ctx.ui?.setStatus?.("piper", statusLine());
        ctx.ui?.notify?.(`Piper: peer disconnected ${shortKey(peer.remoteKey)}`, "info");
        if ((transport?.peerCount() ?? 0) === 0) allowAllPendingApprovals();
      },
      log: (line) => ctx.ui?.notify?.(`Piper: ${line}`, "warning"),
    }, piperDhtOptions());

    try {
      await transport.listen();
      ctx.ui?.setStatus?.("piper", statusLine());
      const paired = allow.list().length;
      ctx.ui?.notify?.(
        `Piper listening.\nInstance key: ${identityHex}` +
          (paired === 0 ? `\nNo paired peers yet - add one with /piper-allow <peer-key>` : ``),
        "info",
      );
    } catch (e: any) {
      ctx.ui?.notify?.(`Piper failed to listen: ${String(e?.message ?? e)}`, "error");
    }
  });

  pi.on("session_shutdown", async () => {
    const t = transport;
    transport = undefined;
    await t?.destroy();
  });

  // Forward Pi's native event stream to all connected managers, and push a
  // presence update whenever the instance flips between busy and idle so a
  // fleet view can show live status.
  for (const name of FORWARDED_EVENTS) {
    pi.on(name as any, async (event: any, ctx: any) => {
      if (name === "agent_start") streaming = true;
      if (name === "agent_end") streaming = false;
      transport?.broadcast({ t: "event", event: safeEvent(name, event) });
      const surface = surfaceFromEvent(name, event, ctx);
      if (surface) broadcastSurface(surface);
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
