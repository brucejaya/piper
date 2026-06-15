/**
 * Piper wire protocol — a thin, Pi-RPC-shaped message set carried over an
 * encrypted HyperDHT duplex stream. Framing is newline-delimited JSON, matching
 * Pi's own RPC JSONL convention (split on `\n`, tolerate a trailing `\r`).
 *
 * Deliberately small for v0: the instance forwards Pi's native AgentEvent
 * objects verbatim under `event`, so the schema is Pi's, not ours.
 */

export const PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1024 * 1024;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

/** Metadata an instance advertises so a manager can render it in a fleet view. */
export interface InstancePresence {
  publicKey: string;
  label: string;
  cwd: string;
  model?: string;
  streaming: boolean;
  sessionFile?: string;
}

export type SurfaceKind = "event" | "artifact" | "metric" | "action" | "approval" | "proposal" | "auth";
export type SurfacePriority = "low" | "normal" | "high" | "critical";
export type AuthRequestMode = "open_url" | "oauth_consent" | "mfa" | "account_selection" | "reauth";
export type AuthResultStatus = "completed" | "failed" | "expired" | "cancelled" | "rejected";
const SURFACE_KINDS: readonly SurfaceKind[] = ["event", "artifact", "metric", "action", "approval", "proposal", "auth"];
const SURFACE_PRIORITIES: readonly SurfacePriority[] = ["low", "normal", "high", "critical"];

export interface SurfaceSource {
  agent?: string;
  harness?: "pi" | "openclaw" | string;
  session?: string;
}

export interface SurfaceSchema {
  version: number;
  url?: string;
}

export interface SurfaceDisplay {
  title?: string;
  subtitle?: string;
  priority?: SurfacePriority;
  icon?: string;
  group?: string;
}

export interface SurfaceEnvelope {
  kind: "surface";
  surface: SurfaceKind;
  type: string;
  id: string;
  ts: number;
  source: SurfaceSource;
  schema: SurfaceSchema;
  summary: string;
  fallback: string;
  display?: SurfaceDisplay;
  payload: JsonRecord;
}

export type BuiltInSurfaceType =
  | "git.commit"
  | "test.result"
  | "artifact.created"
  | "approval.request"
  | "metric.series"
  | "task.update"
  | "experiment.log"
  | "notification"
  | "surface.proposal"
  | "auth.request"
  | "auth.result";

/** Peer (manager) -> instance. */
export type InboundMessage =
  | { t: "prompt"; id?: string; message: string; streamingBehavior?: "steer" | "followUp" }
  | { t: "steer"; id?: string; message: string }
  | { t: "abort"; id?: string }
  | { t: "get_state"; id: string }
  | { t: "get_messages"; id: string }
  | { t: "approval_response"; id: string; decision: "allow" | "block"; reason?: string }
  | { t: "auth_result"; id: string; status: AuthResultStatus; note?: string };

/** Instance -> peer (manager). */
export type OutboundMessage =
  | { t: "hello"; protocol: number; instance: InstancePresence }
  | { t: "presence"; instance: InstancePresence }
  | { t: "event"; event: unknown }
  | { t: "surface"; surface: SurfaceEnvelope }
  | { t: "response"; id: string; ok: true; data?: unknown }
  | { t: "response"; id: string; ok: false; error: string }
  | { t: "approval_request"; id: string; toolName: string; input: unknown };

export type WireMessage = InboundMessage | OutboundMessage;

export interface ProtocolCompatibility {
  supported: boolean;
  reason?: string;
}

/** Encode a message as one framed line. */
export function encode(msg: WireMessage): Buffer {
  return Buffer.from(JSON.stringify(msg) + "\n");
}

export function checkProtocolCompatibility(version: unknown): ProtocolCompatibility {
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { supported: false, reason: "missing or invalid protocol version" };
  }
  if (version < MIN_SUPPORTED_PROTOCOL_VERSION) {
    return { supported: false, reason: `protocol ${version} is older than supported minimum ${MIN_SUPPORTED_PROTOCOL_VERSION}` };
  }
  if (version > PROTOCOL_VERSION) {
    return { supported: false, reason: `protocol ${version} is newer than supported maximum ${PROTOCOL_VERSION}` };
  }
  return { supported: true };
}

export function toJsonRecord(value: unknown): JsonRecord {
  try {
    const parsed = JSON.parse(JSON.stringify(value ?? {}));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    /* fall through */
  }
  return {};
}

export function createSurface(input: {
  surface: SurfaceKind;
  type: BuiltInSurfaceType | string;
  id: string;
  summary: string;
  fallback?: string;
  payload?: unknown;
  source?: SurfaceSource;
  display?: SurfaceDisplay;
  schemaVersion?: number;
  ts?: number;
}): SurfaceEnvelope {
  return {
    kind: "surface",
    surface: input.surface,
    type: input.type,
    id: input.id,
    ts: input.ts ?? Date.now(),
    source: input.source ?? {},
    schema: { version: input.schemaVersion ?? 1 },
    summary: input.summary,
    fallback: input.fallback ?? input.summary,
    ...(input.display ? { display: input.display } : {}),
    payload: toJsonRecord(input.payload),
  };
}

export function createSurfaceProposal(input: {
  proposedType: string;
  rationale: string;
  id?: string;
  requestedDisplay?: string;
  sample?: unknown;
  source?: SurfaceSource;
  ts?: number;
}): SurfaceEnvelope {
  return createSurface({
    surface: "proposal",
    type: "surface.proposal",
    id: input.id ?? `proposal-${Date.now()}`,
    ts: input.ts,
    source: input.source,
    summary: `Surface proposal: ${input.proposedType}`,
    payload: {
      proposedType: input.proposedType,
      requestedDisplay: input.requestedDisplay ?? "card",
      sample: toJsonRecord(input.sample),
      rationale: input.rationale,
    },
    display: {
      title: "Surface proposal",
      subtitle: input.proposedType,
      priority: "normal",
      icon: "layout-template",
      group: "surfaces",
    },
  });
}

export function createAuthRequestSurface(input: {
  id: string;
  mode: AuthRequestMode;
  origin: string;
  domain: string;
  reason: string;
  expiresAt: number;
  requestedScope?: string;
  sessionDestination?: string;
  source?: SurfaceSource;
  ts?: number;
}): SurfaceEnvelope {
  return createSurface({
    surface: "auth",
    type: "auth.request",
    id: input.id,
    ts: input.ts,
    source: input.source,
    summary: `Authentication requested for ${input.domain}`,
    payload: {
      mode: input.mode,
      origin: input.origin,
      domain: input.domain,
      reason: input.reason,
      expiresAt: input.expiresAt,
      requestedScope: input.requestedScope ?? "",
      sessionDestination: input.sessionDestination ?? "agent-browser",
    },
    display: {
      title: "Authentication requested",
      subtitle: input.domain,
      priority: "critical",
      icon: "key-round",
      group: "auth",
    },
  });
}

export function createAuthResultSurface(input: {
  id: string;
  requestId: string;
  status: AuthResultStatus;
  completedAt?: number;
  note?: string;
  source?: SurfaceSource;
  ts?: number;
}): SurfaceEnvelope {
  return createSurface({
    surface: "auth",
    type: "auth.result",
    id: input.id,
    ts: input.ts,
    source: input.source,
    summary: `Authentication ${input.status}`,
    payload: {
      requestId: input.requestId,
      status: input.status,
      completedAt: input.completedAt ?? Date.now(),
      note: input.note ?? "",
    },
    display: {
      title: "Authentication result",
      subtitle: input.status,
      priority: input.status === "completed" ? "normal" : "high",
      icon: input.status === "completed" ? "check" : "x",
      group: "auth",
    },
  });
}

export function isSurfaceEnvelope(value: unknown): value is SurfaceEnvelope {
  if (!value || typeof value !== "object") return false;
  const surface = value as Partial<SurfaceEnvelope>;
  const display = surface.display;
  return (
    surface.kind === "surface" &&
    SURFACE_KINDS.includes(surface.surface as SurfaceKind) &&
    typeof surface.type === "string" &&
    typeof surface.id === "string" &&
    typeof surface.ts === "number" &&
    Number.isFinite(surface.ts) &&
    typeof surface.summary === "string" &&
    typeof surface.fallback === "string" &&
    !!surface.source &&
    typeof surface.source === "object" &&
    !Array.isArray(surface.source) &&
    !!surface.schema &&
    typeof surface.schema === "object" &&
    !Array.isArray(surface.schema) &&
    typeof surface.schema.version === "number" &&
    Number.isInteger(surface.schema.version) &&
    !!surface.payload &&
    typeof surface.payload === "object" &&
    !Array.isArray(surface.payload) &&
    (!display ||
      (typeof display === "object" &&
        !Array.isArray(display) &&
        (!display.priority || SURFACE_PRIORITIES.includes(display.priority))))
  );
}

/**
 * Build a streaming decoder. Returns a function you feed raw chunks; it invokes
 * `onMessage` once per complete JSON line. Malformed lines are skipped.
 */
export function createLineDecoder(
  onMessage: (obj: unknown) => void,
  options: { maxFrameBytes?: number; onInvalidFrame?: (reason: string) => void } = {},
): (chunk: Buffer | string) => void {
  let buffer = "";
  const maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES;
  return (chunk) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.trim().length === 0) continue;
      if (Buffer.byteLength(line, "utf8") > maxFrameBytes) {
        options.onInvalidFrame?.("frame_too_large");
        continue;
      }
      try {
        onMessage(JSON.parse(line));
      } catch {
        options.onInvalidFrame?.("malformed_json");
      }
    }
    if (Buffer.byteLength(buffer, "utf8") > maxFrameBytes) {
      buffer = "";
      options.onInvalidFrame?.("frame_too_large");
    }
  };
}

export function shortKey(hex: string): string {
  return hex.length > 13 ? `${hex.slice(0, 12)}...` : hex;
}
