/**
 * Piper peer CLI.
 *
 * The single tool an external caller (operator agent, local coding agent, or
 * human) uses to talk to Piper instances. The CLI exposes every protocol
 * message as a subcommand plus a small admin surface.
 *
 * Default output is human-friendly. Pass --json for NDJSON. Exit codes:
 *   0 success
 *   1 protocol / runtime error
 *   2 usage error
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import DHT from "hyperdht";
import {
  checkProtocolCompatibility,
  createLineDecoder,
  encode,
  shortKey,
  type AuthResultStatus,
  type InboundMessage,
  type OutboundMessage,
  type ProtocolCompatibility,
  type SurfaceEnvelope,
} from "../src/protocol.js";

export const KEY_RE = /^[0-9a-f]{64}$/i;
export const AUTH_RESULT_STATUSES = new Set<AuthResultStatus>(["completed", "failed", "expired", "cancelled", "rejected"]);

export function peerIdentityDir(): string {
  return process.env.PIPER_PEER_HOME ?? join(homedir(), ".piper-peer");
}

export function loadPeerIdentity() {
  const dir = peerIdentityDir();
  mkdirSync(dir, { recursive: true });
  const seedPath = join(dir, "seed");
  let seed: Buffer;
  if (existsSync(seedPath)) {
    seed = Buffer.from(readFileSync(seedPath, "utf8").trim(), "hex");
  } else {
    seed = randomBytes(32);
    writeFileSync(seedPath, seed.toString("hex"), { mode: 0o600 });
  }
  return DHT.keyPair(seed);
}

export interface PeerConfig {
  instance?: string;
}

export function loadPeerConfig(): PeerConfig {
  const path = join(peerIdentityDir(), "config.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object") return parsed as PeerConfig;
  } catch {
    /* corrupt: ignore */
  }
  return {};
}

export function savePeerConfig(config: PeerConfig): void {
  const dir = peerIdentityDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function defaultInstance(): string | undefined {
  const fromEnv = process.env.PIPER_INSTANCE;
  if (fromEnv) return fromEnv.toLowerCase();
  return loadPeerConfig().instance?.toLowerCase();
}

export function bootstrapOpt(): { bootstrap?: { host: string; port: number }[] } {
  const raw = process.env.PIPER_BOOTSTRAP;
  if (!raw) return {};
  return {
    bootstrap: raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((hp) => ({ host: hp.slice(0, hp.lastIndexOf(":")), port: Number(hp.slice(hp.lastIndexOf(":") + 1)) })),
  };
}

export interface MonitoredInstance {
  key: string;
  label?: string;
}

export interface MonitoredList {
  instances: MonitoredInstance[];
}

export function monitoredListPath(): string {
  return join(peerIdentityDir(), "instances.json");
}

export function loadMonitoredList(): MonitoredList {
  const path = monitoredListPath();
  if (!existsSync(path)) return { instances: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && Array.isArray((parsed as MonitoredList).instances)) {
      return {
        instances: (parsed as MonitoredList).instances.filter(
          (i): i is MonitoredInstance =>
            typeof i?.key === "string" && KEY_RE.test(i.key) && (i.label === undefined || typeof i.label === "string"),
        ),
      };
    }
  } catch {
    /* corrupt */
  }
  return { instances: [] };
}

export function saveMonitoredList(list: MonitoredList): void {
  const dir = peerIdentityDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(monitoredListPath(), JSON.stringify(list, null, 2), { mode: 0o600 });
}

export type Command =
  | { kind: "keys" }
  | { kind: "use"; target: string; clear: boolean }
  | { kind: "instances"; action: "list" | "add" | "remove"; target: string; label?: string }
  | { kind: "send-prompt"; target: string; message: string; behavior: "steer" | "followUp"; id?: string; stream: boolean }
  | { kind: "send-steer"; target: string; message: string; id?: string }
  | { kind: "abort"; target: string; id?: string }
  | { kind: "request-state"; target: string; id?: string }
  | { kind: "request-messages"; target: string; id?: string }
  | { kind: "respond-approval"; target: string; id: string; decision: "allow" | "block"; reason?: string }
  | { kind: "respond-auth-result"; target: string; id: string; status: AuthResultStatus; note?: string }
  | { kind: "watch"; targets: string[] }
  | { kind: "repl"; target: string }
  | { kind: "help" };

export interface GlobalFlags {
  json: boolean;
  id?: string;
  bootstrap?: string;
  peerHome?: string;
}

export function parseArgs(args: string[]): { flags: GlobalFlags; command: Command } {
  const flags: GlobalFlags = { json: false };
  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--json") { flags.json = true; i++; continue; }
    if (a === "--id") { flags.id = args[++i]; i++; continue; }
    if (a === "--bootstrap") { flags.bootstrap = args[++i]; i++; continue; }
    if (a === "--peer-home") { flags.peerHome = args[++i]; i++; continue; }
    if (a === "--help" || a === "-h") { return { flags, command: { kind: "help" } }; }
    positional.push(a);
    i++;
  }
  if (flags.peerHome) process.env.PIPER_PEER_HOME = flags.peerHome;
  if (flags.bootstrap) process.env.PIPER_BOOTSTRAP = flags.bootstrap;

  const [verb, sub, ...rest] = positional;
  if (!verb || verb === "help" || verb === "--help" || verb === "-h") {
    return { flags, command: { kind: "help" } };
  }

  const requireInstance = (raw?: string): string => {
    if (raw) {
      if (!KEY_RE.test(raw)) throw new Error("instance must be a 64-character hex key");
      return raw.toLowerCase();
    }
    const def = defaultInstance();
    if (!def) throw new Error("no instance: pass it as an argument or run `piper use <instance>` first");
    return def;
  };

  switch (verb) {
    case "keys":
      return { flags, command: { kind: "keys" } };
    case "use": {
      const clear = sub === "--clear" || sub === "-c";
      const target = clear ? (rest[0] ?? "") : (sub ?? "");
      if (!clear && !target) throw new Error("usage: piper use <instance-key> | piper use --clear");
      if (target && !KEY_RE.test(target)) throw new Error("instance must be a 64-character hex key");
      return { flags, command: { kind: "use", target: target.toLowerCase(), clear } };
    }
    case "instances": {
      if (!sub || sub === "list") {
        return { flags, command: { kind: "instances", action: "list", target: "" } };
      }
      if (sub === "add") {
        const key = rest[0];
        if (!key) throw new Error("usage: piper instances add <instance-key> [--label <text>]");
        if (!KEY_RE.test(key)) throw new Error("instance must be a 64-character hex key");
        let label: string | undefined;
        for (let j = 1; j < rest.length; j++) {
          if (rest[j] === "--label") label = rest[++j];
        }
        return { flags, command: { kind: "instances", action: "add", target: key.toLowerCase(), label } };
      }
      if (sub === "remove" || sub === "rm") {
        const key = rest[0];
        if (!key) throw new Error("usage: piper instances remove <instance-key>");
        if (!KEY_RE.test(key)) throw new Error("instance must be a 64-character hex key");
        return { flags, command: { kind: "instances", action: "remove", target: key.toLowerCase() } };
      }
      throw new Error("usage: piper instances <list|add|remove> ...");
    }
    case "send": {
      if (sub !== "prompt" && sub !== "steer") {
        throw new Error("usage: piper send <prompt|steer> [flags] <text> [instance]");
      }
      if (sub === "steer") {
        const textParts = rest.slice();
        const trailing = textParts.length > 0 ? extractTrailingKey(textParts) : undefined;
        if (trailing) textParts.pop();
        const text = textParts.join(" ");
        if (!text.trim()) throw new Error("piper send steer requires a non-empty message");
        const target = requireInstance(trailing);
        return { flags, command: { kind: "send-steer", target, message: text, id: flags.id } };
      }
      const promptParts = parsePromptTail(rest, requireInstance);
      if (!promptParts.text.trim()) throw new Error("piper send prompt requires a non-empty message");
      return {
        flags,
        command: {
          kind: "send-prompt",
          target: promptParts.target,
          message: promptParts.text,
          behavior: promptParts.behavior,
          id: flags.id,
          stream: promptParts.stream,
        },
      };
    }
    case "abort": {
      const target = requireInstance(sub);
      return { flags, command: { kind: "abort", target, id: flags.id } };
    }
    case "request": {
      if (sub === "get-state") {
        const target = requireInstance(rest[0]);
        return { flags, command: { kind: "request-state", target, id: flags.id } };
      }
      if (sub === "get-messages") {
        const target = requireInstance(rest[0]);
        return { flags, command: { kind: "request-messages", target, id: flags.id } };
      }
      throw new Error("usage: piper request <get-state|get-messages> [instance]");
    }
    case "respond": {
      if (sub === "approval") return parseApproval(rest, flags, requireInstance);
      if (sub === "auth-result") return parseAuthResult(rest, flags, requireInstance);
      throw new Error("usage: piper respond <approval|auth-result> ...");
    }
    case "watch": {
      const useAll = sub === "--all" || sub === "-a";
      const keys: string[] = useAll
        ? loadMonitoredList().instances.map((i) => i.key)
        : [sub, ...rest].filter((k): k is string => typeof k === "string" && k.length > 0);
      if (useAll && keys.length === 0) {
        throw new Error("watch --all: no instances in ~/.piper-peer/instances.json; run `piper instances add <key>` first");
      }
      for (const k of keys) {
        if (!KEY_RE.test(k)) throw new Error(`watch: not a 64-hex instance key: ${k}`);
      }
      return { flags, command: { kind: "watch", targets: keys.map((k) => k.toLowerCase()) } };
    }
    case "repl": {
      const target = requireInstance(sub);
      return { flags, command: { kind: "repl", target } };
    }
    default:
      throw new Error(`unknown command: ${verb}`);
  }
}

function extractTrailingKey(rest: string[]): string | undefined {
  if (rest.length === 0) return undefined;
  const last = rest[rest.length - 1];
  return KEY_RE.test(last) ? last : undefined;
}

interface PromptParts {
  text: string;
  behavior: "steer" | "followUp";
  target: string;
  stream: boolean;
}

function parsePromptTail(rest: string[], requireInstance: (raw?: string) => string): PromptParts {
  let behavior: "steer" | "followUp" = "steer";
  let stream = false;
  const textParts: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--steer") { behavior = "steer"; continue; }
    if (a === "--follow-up") { behavior = "followUp"; continue; }
    if (a === "--stream") { stream = true; continue; }
    if (a === "--id" || a === "--max" || a === "--bootstrap" || a === "--peer-home") { i++; continue; }
    textParts.push(a);
  }
  let maybeInstance: string | undefined;
  if (textParts.length > 0 && KEY_RE.test(textParts[textParts.length - 1])) {
    maybeInstance = textParts.pop();
  }
  const target = requireInstance(maybeInstance);
  return { text: textParts.join(" "), behavior, target, stream };
}

function parseApproval(rest: string[], flags: GlobalFlags, requireInstance: (raw?: string) => string) {
  const id = rest.shift();
  if (!id) throw new Error("usage: piper respond approval <approval-id> --allow|--block [--reason <text>] [instance]");
  let decision: "allow" | "block" | undefined;
  let reason: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--allow") decision = "allow";
    else if (a === "--block") decision = "block";
    else if (a === "--reason") reason = rest[++i];
  }
  if (!decision) throw new Error("piper respond approval requires --allow or --block");
  const target = requireInstance();
  return { flags, command: { kind: "respond-approval" as const, target, id, decision, reason } };
}

function parseAuthResult(rest: string[], flags: GlobalFlags, requireInstance: (raw?: string) => string) {
  const id = rest.shift();
  if (!id) throw new Error("usage: piper respond auth-result <request-id> --status <status> [--note <text>] [instance]");
  let status: AuthResultStatus | undefined;
  let note: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--status") status = rest[++i] as AuthResultStatus;
    else if (a === "--note") note = rest[++i];
  }
  if (!status || !AUTH_RESULT_STATUSES.has(status)) {
    throw new Error(`piper respond auth-result requires --status one of ${[...AUTH_RESULT_STATUSES].join("|")}`);
  }
  const target = requireInstance();
  return { flags, command: { kind: "respond-auth-result" as const, target, id, status, note } };
}

export function buildRequest(
  command: Exclude<Command, { kind: "keys" | "use" | "help" | "repl" | "watch" | "instances" }>,
  id: string,
): InboundMessage {
  switch (command.kind) {
    case "send-prompt":
      return { t: "prompt", id, message: command.message, streamingBehavior: command.behavior };
    case "send-steer":
      return { t: "steer", id, message: command.message };
    case "abort":
      return { t: "abort", id };
    case "request-state":
      return { t: "get_state", id };
    case "request-messages":
      return { t: "get_messages", id };
    case "respond-approval":
      return { t: "approval_response", id: command.id, decision: command.decision, reason: command.reason };
    case "respond-auth-result":
      return { t: "auth_result", id: command.id, status: command.status, note: command.note };
  }
}

// ---------- Envelopes & formatter ----------

export type CliEnvelope =
  | { t: "session"; state: "open"; peerKey: string; instanceKey?: string; instanceLabel?: string }
  | { t: "session"; state: "ready"; instanceKey: string; instance: { publicKey: string; label: string; cwd: string; model?: string; streaming: boolean; sessionFile?: string } }
  | { t: "session"; state: "incompatible"; reason: string; instanceKey?: string }
  | { t: "session"; state: "reconnecting"; instanceKey: string; attempt: number; maxAttempts: number; delayMs: number }
  | { t: "session"; state: "closed"; instanceKey?: string; reason?: string }
  | { t: "session"; state: "error"; reason: string; instanceKey?: string }
  | { t: "info"; message: string }
  | { t: "auth_request_hint"; id: string; instanceKey?: string; reason?: string; domain?: string }
  | (OutboundMessage & { instanceKey?: string; instanceLabel?: string });

export interface Formatter {
  emit(line: CliEnvelope): void;
  error(reason: string): void;
  close(): void;
}

export function makeFormatter(json: boolean): Formatter {
  if (json) {
    return {
      emit: (line) => process.stdout.write(`${JSON.stringify(line)}\n`),
      error: (reason) => process.stderr.write(`${JSON.stringify({ t: "error", reason })}\n`),
      close: () => {},
    };
  }
  return {
    emit: (line) => printHuman(line),
    error: (reason) => process.stderr.write(`[piper] ${reason}\n`),
    close: () => {},
  };
}

function printHuman(line: CliEnvelope): void {
  if (line.t === "session") {
    if (line.state === "open") {
      const tag = line.instanceLabel ? ` (${line.instanceLabel})` : "";
      process.stdout.write(`[piper${tag}] connected (my peer key ${shortKey(line.peerKey)})\n`);
    } else if (line.state === "ready") {
      const inst = line.instance;
      const tag = inst.label ? ` (${inst.label})` : "";
      process.stdout.write(`[piper${tag}] ready: ${inst.label} - model ${inst.model ?? "?"} - cwd ${inst.cwd}\n`);
    } else if (line.state === "incompatible") {
      const tag = line.instanceKey ? ` (${shortKey(line.instanceKey)})` : "";
      process.stdout.write(`[piper${tag}] incompatible: ${line.reason}\n`);
    } else if (line.state === "reconnecting") {
      process.stdout.write(`[piper] reconnecting to ${shortKey(line.instanceKey)} (attempt ${line.attempt}/${line.maxAttempts}) in ${Math.round(line.delayMs / 1000)}s...\n`);
    } else if (line.state === "closed") {
      const tag = line.instanceKey ? ` (${shortKey(line.instanceKey)})` : "";
      process.stdout.write(`[piper${tag}] connection closed${line.reason ? `: ${line.reason}` : ""}\n`);
    } else if (line.state === "error") {
      const tag = line.instanceKey ? ` (${shortKey(line.instanceKey)})` : "";
      process.stdout.write(`[piper${tag}] error: ${line.reason}\n`);
    }
    return;
  }
  if (line.t === "info") {
    process.stdout.write(`[piper] ${line.message}\n`);
    return;
  }
  if (line.t === "auth_request_hint") {
    process.stdout.write(`\n[auth-handoff] id=${line.id}${line.domain ? ` domain=${line.domain}` : ""}${line.reason ? ` reason="${line.reason}"` : ""}\n`);
    process.stdout.write(`Use: piper respond auth-result ${line.id} --status completed|failed|expired|cancelled|rejected [--note <text>]\n`);
    return;
  }
  const msg = line;
  const tag = msg.instanceLabel ? `[${msg.instanceLabel}] ` : "";
  switch (msg.t) {
    case "hello":
      return;
    case "presence":
      process.stdout.write(`${tag}[presence] ${msg.instance.label} is ${msg.instance.streaming ? "busy" : "idle"}\n`);
      return;
    case "event": {
      const e = msg.event as Record<string, unknown>;
      if (e.type === "message_update") {
        const inner = e.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        if (inner?.type === "text_delta" && typeof inner.delta === "string") {
          process.stdout.write(tag + inner.delta);
          return;
        }
      }
      if (e.type === "tool_execution_start") {
        process.stdout.write(`${tag}\n[tool:start] ${String(e.toolName)} ${JSON.stringify(e.args ?? {})}\n`);
        return;
      }
      if (e.type === "tool_execution_end") {
        process.stdout.write(`${tag}[tool:end] ${e.isError ? "error" : "ok"} ${String(e.toolName)}\n`);
        return;
      }
      if (e.type === "agent_end") {
        process.stdout.write(`${tag}\n`);
        return;
      }
      if (e.type === "agent_start") {
        process.stdout.write(`${tag}[agent:start]\n`);
        return;
      }
      return;
    }
    case "surface":
      printSurface(msg.surface, tag);
      return;
    case "response":
      if (msg.ok) {
        process.stdout.write(`${tag}[response] ${msg.id} ok${msg.data !== undefined ? ` ${JSON.stringify(msg.data)}` : ""}\n`);
      } else {
        process.stdout.write(`${tag}[response] ${msg.id} error: ${msg.error}\n`);
      }
      return;
    case "approval_request":
      process.stdout.write(`${tag}\n[approval] id=${msg.id} ${msg.toolName} ${JSON.stringify(msg.input)}\n`);
      process.stdout.write(`Use: piper respond approval ${msg.id} --allow|--block [--reason <text>]\n`);
      return;
  }
}

function printSurface(surface: SurfaceEnvelope, tag: string): void {
  const s = surface as SurfaceEnvelope & {
    id?: string;
    mode?: string;
    origin?: string;
    domain?: string;
    reason?: string;
  };
  if (s.mode === "open_url" || surface.type === "auth_request") {
    process.stdout.write(`${tag}\n[auth-handoff] id=${s.id ?? "?"}${s.domain ? ` domain=${s.domain}` : ""}${s.reason ? ` reason="${s.reason}"` : ""}\n`);
    process.stdout.write(`Use: piper respond auth-result ${s.id ?? "<id>"} --status completed|failed|expired|cancelled|rejected [--note <text>]\n`);
    return;
  }
  process.stdout.write(`${tag}[surface] ${surface.type} - ${surface.fallback}\n`);
}

// ---------- Connection engine ----------

interface OpenConnection {
  socket: any;
  node: any;
  pending: Map<string, (msg: OutboundMessage) => void>;
  closed: boolean;
  ready: boolean;
  readyWaiters: Array<() => void>;
  hello?: OutboundMessage & { t: "hello" };
  target: string;
  /** Receives all non-protocol-control outbound messages (event, surface,
   *  presence, approval_request). Set by the dispatcher after open. */
  streamListener?: (msg: OutboundMessage) => void;
}

/**
 * Open a connection. The returned `conn.streamListener` is the **only** way
 * to receive streamed outbound messages: HyperDHT's UDX socket only
 * delivers data to a single listener, so we centralize the decoder here
 * and route messages by type.
 */
async function openConnection(
  target: string,
  streamListener?: (msg: OutboundMessage) => void,
): Promise<OpenConnection> {
  const kp = loadPeerIdentity();
  const node = new DHT({ keyPair: kp, ...bootstrapOpt() });
  const socket = node.connect(Buffer.from(target, "hex"), { keyPair: kp });

  const conn: OpenConnection = {
    socket,
    node,
    pending: new Map(),
    closed: false,
    ready: false,
    readyWaiters: [],
    target,
    streamListener,
  };

  socket.on("data", createLineDecoder((raw) => {
    const msg = raw as OutboundMessage;
    if (msg.t === "hello") {
      const compat: ProtocolCompatibility = checkProtocolCompatibility(msg.protocol);
      if (!compat.supported) {
        conn.closed = true;
        socket.destroy();
        return;
      }
      conn.hello = msg;
      conn.ready = true;
      for (const w of conn.readyWaiters) w();
      conn.readyWaiters.length = 0;
      return;
    }
    if (msg.t === "response") {
      const resolve = conn.pending.get(msg.id);
      if (resolve) {
        conn.pending.delete(msg.id);
        resolve(msg);
      }
      return;
    }
    conn.streamListener?.(msg);
  }));

  await new Promise<void>((resolve, reject) => {
    const onClose = () => reject(new Error("socket closed before open"));
    socket.once("close", onClose);
    socket.once("open", () => {
      socket.off("close", onClose);
      resolve();
    });
    socket.once("error", (err: Error) => reject(err));
    setTimeout(() => reject(new Error("socket open timeout")), 10_000);
  });

  return conn;
}

function waitForReady(conn: OpenConnection): Promise<void> {
  if (conn.ready) return Promise.resolve();
  return new Promise((resolve) => conn.readyWaiters.push(resolve));
}

async function roundTrip(conn: OpenConnection, request: InboundMessage): Promise<OutboundMessage> {
  const id = request.id;
  if (!id) throw new Error("request requires an id");
  const { promise, resolve, reject } = Promise.withResolvers<OutboundMessage>();
  conn.pending.set(id, resolve);
  const onClose = () => reject(new Error("connection closed before response"));
  conn.socket.once("close", onClose);
  conn.socket.write(encode(request));
  try {
    return await promise;
  } finally {
    conn.socket.off("close", onClose);
  }
}

function tagEvent(msg: OutboundMessage, conn: OpenConnection): OutboundMessage & { instanceKey: string; instanceLabel?: string } {
  return { ...msg, instanceKey: conn.target, instanceLabel: conn.hello?.instance.label };
}

const RECONNECT_BACKOFFS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

interface ReconnectOptions {
  formatter: Formatter;
  open: (target: string) => Promise<OpenConnection>;
  onConnected: (conn: OpenConnection) => Promise<number>;
  shouldReconnect: (err: Error) => boolean;
  signal: AbortSignal;
}

async function withReconnect(opts: ReconnectOptions, target: string): Promise<number> {
  let attempt = 0;
  while (!opts.signal.aborted) {
    try {
      const conn = await opts.open(target);
      return await opts.onConnected(conn);
    } catch (e) {
      const err = e as Error;
      if (!opts.shouldReconnect(err)) return 1;
      if (attempt >= RECONNECT_BACKOFFS_MS.length) {
        opts.formatter.error(`reconnect: gave up after ${attempt} attempts to ${shortKey(target)}`);
        return 1;
      }
      const delayMs = RECONNECT_BACKOFFS_MS[attempt]!;
      opts.formatter.emit({
        t: "session",
        state: "reconnecting",
        instanceKey: target,
        attempt: attempt + 1,
        maxAttempts: RECONNECT_BACKOFFS_MS.length,
        delayMs,
      });
      attempt++;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delayMs);
        opts.signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      });
      if (opts.signal.aborted) return 0;
    }
  }
  return 0;
}

export interface RunOptions {
  flags: GlobalFlags;
  formatter: Formatter;
  autoApprove: boolean;
}

export async function runCommand(command: Command, opts: RunOptions): Promise<number> {
  const f = opts.formatter;
  switch (command.kind) {
    case "help":
      process.stdout.write(usage() + "\n");
      return 0;
    case "keys": {
      const kp = loadPeerIdentity();
      const key = kp.publicKey.toString("hex");
      if (opts.flags.json) {
        f.emit({ t: "info", message: key });
      } else {
        process.stdout.write(`${key}\n`);
        process.stdout.write(`\nPair it in the Pi instance with: /piper-allow ${key}\n`);
      }
      return 0;
    }
    case "use": {
      const cfg = loadPeerConfig();
      if (command.clear) {
        delete cfg.instance;
      } else {
        cfg.instance = command.target;
      }
      savePeerConfig(cfg);
      f.emit({ t: "info", message: command.clear ? "default instance cleared" : `default instance set to ${shortKey(command.target)}` });
      return 0;
    }
    case "instances": {
      const list = loadMonitoredList();
      if (command.action === "list") {
        if (opts.flags.json) {
          f.emit({ t: "info", message: JSON.stringify(list) });
        } else {
          if (list.instances.length === 0) {
            process.stdout.write("(no monitored instances; run `piper instances add <key>`)\n");
          } else {
            for (const i of list.instances) {
              const label = i.label ? ` (${i.label})` : "";
              process.stdout.write(`${i.key}${label}\n`);
            }
          }
        }
        return 0;
      }
      if (command.action === "add") {
        const existing = list.instances.findIndex((i) => i.key === command.target);
        if (existing >= 0) {
          list.instances[existing]!.label = command.label;
        } else {
          list.instances.push({ key: command.target, label: command.label });
        }
        saveMonitoredList(list);
        f.emit({ t: "info", message: `added ${shortKey(command.target)}${command.label ? ` (${command.label})` : ""}` });
        return 0;
      }
      const before = list.instances.length;
      list.instances = list.instances.filter((i) => i.key !== command.target);
      saveMonitoredList(list);
      f.emit({ t: "info", message: before === list.instances.length ? `no change (${shortKey(command.target)} not in list)` : `removed ${shortKey(command.target)}` });
      return 0;
    }
    case "watch": {
      const controller = new AbortController();
      const onSig = () => controller.abort();
      process.once("SIGINT", onSig);
      process.once("SIGTERM", onSig);
      const code = await runWatch(command.targets, opts, controller.signal);
      process.off("SIGINT", onSig);
      process.off("SIGTERM", onSig);
      return code;
    }
    case "repl": {
      const controller = new AbortController();
      const onSig = () => controller.abort();
      process.once("SIGINT", onSig);
      process.once("SIGTERM", onSig);
      const code = await withReconnect(
        {
          formatter: f,
          open: (t) => openConnection(t, (msg) => f.emit({ ...tagEvent(msg, { target: t } as OpenConnection), instanceKey: t })),
          onConnected: async (conn) => runRepl(conn, command.target, f),
          shouldReconnect: (e) => !/no instance/i.test(e.message),
          signal: controller.signal,
        },
        command.target,
      );
      process.off("SIGINT", onSig);
      process.off("SIGTERM", onSig);
      return code;
    }
    case "send-prompt": {
      if (command.stream) {
        const controller = new AbortController();
        const onSig = () => controller.abort();
        process.once("SIGINT", onSig);
        process.once("SIGTERM", onSig);
        const code = await withReconnect(
          {
            formatter: f,
            open: (t) => {
              // The stream listener is wired in `onConnected` because we
              // need `conn.hello` for the instance label. Until then,
              // events are buffered inside openConnection's streamListener
              // slot... actually, the slot is set once at open time. So
              // we set it to a no-op for open, then replace after hello.
              return openConnection(t, () => { /* replaced in onConnected */ });
            },
            onConnected: async (conn) => {
              const myKey = loadPeerIdentity().publicKey.toString("hex");
              f.emit({ t: "session", state: "open", peerKey: myKey, instanceKey: conn.target, instanceLabel: conn.hello?.instance.label });
              await waitForReady(conn);
              if (conn.hello) {
                f.emit({ t: "session", state: "ready", instanceKey: conn.target, instance: conn.hello.instance });
              }
              // Now wire the real stream listener.
              conn.streamListener = (msg) => f.emit(tagEvent(msg, conn));
              const id = (command as { id?: string }).id ?? randomUUID();
              const request = buildRequest(command, id);
              const response = await roundTrip(conn, request);
              if (response.t === "response") {
                f.emit({ ...response, instanceKey: conn.target, instanceLabel: conn.hello?.instance.label });
                if (!response.ok) {
                  conn.socket.destroy();
                  return 1;
                }
              }
              // Stay open until SIGINT / socket close.
              await new Promise<void>((resolve) => {
                const closer = (): void => {
                  conn.socket.off("close", closer);
                  resolve();
                };
                conn.socket.once("close", closer);
                if (controller.signal.aborted) closer();
              });
              conn.socket.destroy();
              return controller.signal.aborted ? 0 : 1;
            },
            shouldReconnect: () => true,
            signal: controller.signal,
          },
          command.target,
        );
        process.off("SIGINT", onSig);
        process.off("SIGTERM", onSig);
        return code;
      }
    }
    /* fall through to one-shot path */
    case "send-steer":
    case "abort":
    case "request-state":
    case "request-messages":
    case "respond-approval":
    case "respond-auth-result": {
      const conn = await openConnection(command.target);
      const myKey = loadPeerIdentity().publicKey.toString("hex");
      f.emit({ t: "session", state: "open", peerKey: myKey, instanceKey: conn.target, instanceLabel: conn.hello?.instance.label });
      await waitForReady(conn);
      const id = (command as { id?: string }).id ?? randomUUID();
      const request = buildRequest(command, id);
      const response = await roundTrip(conn, request);
      if (response.t === "response") {
        f.emit({ ...response, instanceKey: conn.target, instanceLabel: conn.hello?.instance.label });
        conn.socket.destroy();
        return response.ok ? 0 : 1;
      }
      conn.socket.destroy();
      return 1;
    }
  }
}

async function runWatch(targets: string[], opts: RunOptions, signal: AbortSignal): Promise<number> {
  const f = opts.formatter;
  const tasks = targets.map((target) =>
    withReconnect(
      {
        formatter: f,
        open: async (t) => {
          const conn = await openConnection(t);
          const myKey = loadPeerIdentity().publicKey.toString("hex");
          f.emit({ t: "session", state: "open", peerKey: myKey, instanceKey: t });
          return conn;
        },
        onConnected: async (conn) => {
          await waitForReady(conn);
          if (conn.hello) {
            f.emit({ t: "session", state: "ready", instanceKey: conn.target, instance: conn.hello.instance });
          }
          // Wire the stream listener now that hello has set the label.
          conn.streamListener = (msg) => f.emit(tagEvent(msg, conn));
          conn.socket.once("close", () => {
            f.emit({ t: "session", state: "closed", instanceKey: conn.target });
          });
          await new Promise<void>((resolve) => {
            const closer = (): void => {
              conn.socket.off("close", closer);
              resolve();
            };
            conn.socket.once("close", closer);
            if (signal.aborted) closer();
          });
          return 0;
        },
        shouldReconnect: () => !signal.aborted,
        signal,
      },
      target,
    ),
  );
  const codes = await Promise.all(tasks);
  return codes.every((c) => c === 0) ? 0 : 1;
}

function runRepl(conn: OpenConnection, target: string, f: Formatter): Promise<number> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    const send = async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (trimmed === "/quit" || trimmed === "/exit") { rl.close(); return; }
      if (trimmed === "/help") { process.stdout.write(replHelp() + "\n"); return; }
      if (trimmed === "/state") return send(`request get-state ${target}`);
      if (trimmed === "/messages") return send(`request get-messages ${target}`);
      if (trimmed === "/abort") return send(`abort ${target}`);
      if (trimmed.startsWith("/approve ")) {
        const rest = trimmed.slice("/approve ".length).trim();
        return send(`respond approval ${rest} --allow`);
      }
      if (trimmed.startsWith("/block ")) {
        const rest = trimmed.slice("/block ".length).trim();
        return send(`respond approval ${rest} --block`);
      }
      const id = randomUUID();
      const { promise, resolve } = Promise.withResolvers<OutboundMessage>();
      conn.pending.set(id, resolve);
      conn.socket.write(encode({ t: "prompt", id, message: trimmed }));
      const response = await promise;
      f.emit({ ...response, instanceKey: conn.target, instanceLabel: conn.hello?.instance.label });
    };

    rl.on("line", (line) => { void send(line); });
    rl.on("close", () => {
      conn.socket.destroy();
      resolve(0);
    });
  });
}

function replHelp(): string {
  return [
    "Piper REPL commands:",
    "  <text>             send a prompt",
    "  /state             request get-state",
    "  /messages          request get-messages",
    "  /abort             abort the running turn",
    "  /approve <id>      approve a pending approval (with optional [reason])",
    "  /block <id>        block a pending approval (with optional [reason])",
    "  /quit, /exit       disconnect",
  ].join("\n");
}

export function usage(): string {
  return [
    "Piper peer CLI",
    "",
    "Identity:",
    "  keys                                     print this peer's public key",
    "",
    "Default instance:",
    "  use <instance-key>                       pin a default instance (~/.piper-peer/config.json)",
    "  use --clear                              clear the default",
    "  (PIPER_INSTANCE env var overrides the default)",
    "",
    "Monitored instances (used by `watch --all`):",
    "  instances list",
    "  instances add <instance-key> [--label <text>]",
    "  instances remove <instance-key>",
    "",
    "Send a request:",
    "  send prompt <text> [--steer|--follow-up] [--stream] [instance]",
    "  send steer <text> [instance]",
    "  abort [instance]",
    "",
    "Request:",
    "  request get-state [instance]",
    "  request get-messages [instance]",
    "",
    "Respond to a pending request:",
    "  respond approval <id> --allow|--block [--reason <text>] [instance]",
    "  respond auth-result <id> --status <status> [--note <text>] [instance]",
    "",
    "Stream:",
    "  watch [<key>...] | --all                 pretty or NDJSON event stream (one or many)",
    "  repl [instance]                           interactive loop (REPL)",
    "",
    "Global flags:",
    "  --json                                   emit NDJSON instead of human output",
    "  --id <id>                                caller-supplied request id",
    "  --bootstrap <host:port>                  DHT bootstrap (overrides env + local file)",
    "  --peer-home <dir>                        override peer identity directory",
    "  --help, -h                               show this help",
  ].join("\n");
}

export async function main(): Promise<number> {
  let parsed: { flags: GlobalFlags; command: Command };
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`[piper] ${(e as Error).message}\n`);
    process.stderr.write(`\n${usage()}\n`);
    return 2;
  }
  const { flags, command } = parsed;
  if (command.kind === "help") {
    process.stdout.write(usage() + "\n");
    return 0;
  }
  const formatter = makeFormatter(flags.json);
  try {
    return await runCommand(command, { flags, formatter, autoApprove: process.env.PIPER_AUTO_APPROVE === "1" });
  } catch (e) {
    formatter.error((e as Error).message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((code) => process.exit(code));
}
