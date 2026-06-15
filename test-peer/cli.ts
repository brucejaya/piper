/**
 * Reference manager client for Piper.
 *
 *   npm run peer                         # print this peer's public key
 *   npm run peer -- <instance-key-hex>   # connect interactively
 *   npm run peer -- <instance-key> --state
 *   npm run peer -- <instance-key> --prompt "hello"
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import DHT from "hyperdht";
import { createLineDecoder, encode, shortKey, type InboundMessage, type OutboundMessage, type SurfaceEnvelope } from "../src/protocol.js";

type Command =
  | { kind: "interactive"; target: string }
  | { kind: "print_key" }
  | { kind: "state"; target: string }
  | { kind: "messages"; target: string }
  | { kind: "prompt"; target: string; message: string; steer: boolean }
  | { kind: "abort"; target: string };

const KEY_RE = /^[0-9a-f]{64}$/i;

function loadPeerIdentity() {
  const dir = join(homedir(), ".piper-peer");
  mkdirSync(dir, { recursive: true });
  const seedPath = join(dir, "seed");
  let seed: Buffer;
  if (existsSync(seedPath)) seed = Buffer.from(readFileSync(seedPath, "utf8").trim(), "hex");
  else {
    seed = randomBytes(32);
    writeFileSync(seedPath, seed.toString("hex"), { mode: 0o600 });
  }
  return DHT.keyPair(seed);
}

function bootstrapOpt() {
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

function usage(myKey?: string): string {
  const keyLines = myKey
    ? [
        "Piper reference peer public key:",
        "",
        `  ${myKey}`,
        "",
        "Pair it in the Pi instance with:",
        "",
        `  /piper-allow ${myKey}`,
        "",
      ]
    : [];
  return [
    ...keyLines,
    "Usage:",
    "  npm run peer",
    "  npm run peer -- <instance-key>",
    "  npm run peer -- <instance-key> --state",
    "  npm run peer -- <instance-key> --messages",
    "  npm run peer -- <instance-key> --prompt \"message\"",
    "  npm run peer -- <instance-key> --steer \"message\"",
    "  npm run peer -- <instance-key> --abort",
  ].join("\n");
}

function parseArgs(args: string[]): Command {
  const [target, flag, ...rest] = args;
  if (!target) return { kind: "print_key" };
  if (target === "--help" || target === "-h") return { kind: "print_key" };
  if (!KEY_RE.test(target)) throw new Error("target must be a 64-character hex instance key");

  if (!flag) return { kind: "interactive", target: target.toLowerCase() };
  if (flag === "--state") return { kind: "state", target: target.toLowerCase() };
  if (flag === "--messages") return { kind: "messages", target: target.toLowerCase() };
  if (flag === "--abort") return { kind: "abort", target: target.toLowerCase() };
  if (flag === "--prompt" || flag === "--steer") {
    const message = rest.join(" ").trim();
    if (!message) throw new Error(`${flag} requires a message`);
    return { kind: "prompt", target: target.toLowerCase(), message, steer: flag === "--steer" };
  }
  throw new Error(`unknown option: ${flag}`);
}

function requestFor(command: Exclude<Command, { kind: "interactive" | "print_key" }>): InboundMessage {
  const id = randomUUID();
  switch (command.kind) {
    case "state":
      return { t: "get_state", id };
    case "messages":
      return { t: "get_messages", id };
    case "prompt":
      return command.steer ? { t: "steer", id, message: command.message } : { t: "prompt", id, message: command.message };
    case "abort":
      return { t: "abort", id };
  }
}

function printSurface(surface: SurfaceEnvelope): void {
  const title = surface.display?.title ?? surface.summary;
  const subtitle = surface.display?.subtitle ? ` - ${surface.display.subtitle}` : "";
  const priority = surface.display?.priority && surface.display.priority !== "normal" ? ` ${surface.display.priority}` : "";

  switch (surface.type) {
    case "git.commit":
      console.log(`[surface:commit${priority}] ${title}${subtitle} ${JSON.stringify(surface.payload)}`);
      break;
    case "task.update":
      console.log(`[surface:task${priority}] ${title}${subtitle} ${JSON.stringify(surface.payload)}`);
      break;
    case "approval.request":
      console.log(`[surface:approval${priority}] ${title}${subtitle} ${JSON.stringify(surface.payload)}`);
      break;
    case "auth.request":
      console.log(`[surface:auth${priority}] ${title}${subtitle} ${JSON.stringify(surface.payload)}`);
      break;
    case "auth.result":
      console.log(`[surface:auth-result${priority}] ${title}${subtitle} ${JSON.stringify(surface.payload)}`);
      break;
    default:
      console.log(`[surface:${surface.type}${priority}] ${surface.fallback} ${JSON.stringify(surface.payload)}`);
      break;
  }
}

function printEvent(msg: OutboundMessage, socket: any): void {
  switch (msg.t) {
    case "hello":
      console.log(`[instance] ${msg.instance.label} - model ${msg.instance.model ?? "?"} - cwd ${msg.instance.cwd}`);
      break;
    case "presence":
      console.log(`[presence] ${msg.instance.label} is ${msg.instance.streaming ? "busy" : "idle"}`);
      break;
    case "event": {
      const e = msg.event as any;
      if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
        process.stdout.write(e.assistantMessageEvent.delta);
      } else if (e.type === "tool_execution_start") {
        console.log(`\n[tool:start] ${e.toolName} ${JSON.stringify(e.args ?? {})}`);
      } else if (e.type === "tool_execution_end") {
        console.log(`[tool:end] ${e.isError ? "error" : "ok"} ${e.toolName}`);
      } else if (e.type === "agent_end") {
        process.stdout.write("\n");
      }
      break;
    }
    case "surface":
      printSurface(msg.surface);
      break;
    case "response":
      console.log(`[response] ${msg.id} ${msg.ok ? "ok" : `error: ${msg.error}`}${msg.ok && msg.data !== undefined ? ` ${JSON.stringify(msg.data)}` : ""}`);
      break;
    case "approval_request":
      console.log(`\n[approval] ${msg.toolName} ${JSON.stringify(msg.input)} -> auto-allowing`);
      socket.write(encode({ t: "approval_response", id: msg.id, decision: "allow" }));
      break;
  }
}

async function connect(command: Exclude<Command, { kind: "print_key" }>, kp: any, myKey: string): Promise<void> {
  const node = new DHT({ keyPair: kp, ...bootstrapOpt() });
  const socket = node.connect(Buffer.from(command.target, "hex"), { keyPair: kp });

  let opened = false;
  let sentOneShot = false;

  socket.on("open", () => {
    opened = true;
    console.log(`connected to ${shortKey(command.target)}`);
    console.log(`my peer key: ${myKey}`);
    if (command.kind === "interactive") {
      console.log("type /help for commands, or type a prompt and press enter (Ctrl+C to quit):\n");
      return;
    }
  });

  socket.on("data", createLineDecoder((raw) => {
    const msg = raw as OutboundMessage;
    printEvent(msg, socket);
    if (command.kind !== "interactive" && msg.t === "hello" && !sentOneShot) {
      sentOneShot = true;
      socket.write(encode(requestFor(command)));
    } else if (command.kind !== "interactive" && msg.t === "response") {
      socket.destroy();
    }
  }));

  socket.on("error", (e: any) => console.error("socket error:", e?.message ?? e));
  socket.on("close", async () => {
    await node.destroy();
    if (!opened) process.exitCode = 1;
    process.exit();
  });

  if (command.kind === "interactive") {
    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const text = line.trim();
      if (!text) return;
      if (text === "/help") {
        console.log(["Commands:", "  /state", "  /messages", "  /abort", "  /steer <message>", "  /quit", "  <message> sends a prompt"].join("\n"));
      } else if (text === "/quit" || text === "/exit") {
        socket.destroy();
      } else if (text === "/state") {
        socket.write(encode({ t: "get_state", id: randomUUID() }));
      } else if (text === "/messages") {
        socket.write(encode({ t: "get_messages", id: randomUUID() }));
      } else if (text === "/abort") {
        socket.write(encode({ t: "abort", id: randomUUID() }));
      } else if (text.startsWith("/steer ")) {
        socket.write(encode({ t: "steer", id: randomUUID(), message: text.slice("/steer ".length).trim() }));
      } else {
        socket.write(encode({ t: "prompt", id: randomUUID(), message: text }));
      }
    });
  }
}

async function main() {
  const kp = loadPeerIdentity();
  const myKey = kp.publicKey.toString("hex");

  try {
    const command = parseArgs(process.argv.slice(2));
    if (command.kind === "print_key") {
      console.log(usage(myKey));
      return;
    }
    await connect(command, kp, myKey);
  } catch (e: any) {
    console.error(`error: ${String(e?.message ?? e)}\n`);
    console.error(usage());
    process.exit(1);
  }
}

void main();
