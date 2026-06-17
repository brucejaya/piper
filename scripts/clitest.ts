/**
 * Offline tests for the Piper peer CLI.
 */
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTH_RESULT_STATUSES,
  buildRequest,
  defaultInstance,
  loadMonitoredList,
  loadPeerConfig,
  loadPeerIdentity,
  makeFormatter,
  monitoredListPath,
  parseArgs,
  peerIdentityDir,
  saveMonitoredList,
  savePeerConfig,
  type Command,
} from "../test-peer/cli.js";

const target = "a".repeat(64);
const targetB = "b".repeat(64);
const home = mkdtempSync(join(tmpdir(), "piper-cli-home-"));
process.env.PIPER_PEER_HOME = home;
const savedBootstrap = process.env.PIPER_BOOTSTRAP;
process.env.PIPER_BOOTSTRAP = "127.0.0.1:1";

type OneShot = Exclude<Command, { kind: "keys" | "use" | "help" | "repl" | "watch" | "instances" }>;

function oneShot(args: string[]): OneShot {
  const c = parseArgs(args).command;
  if (
    c.kind === "keys" ||
    c.kind === "use" ||
    c.kind === "help" ||
    c.kind === "repl" ||
    c.kind === "watch" ||
    c.kind === "instances"
  ) {
    throw new Error(`expected one-shot command, got ${c.kind}`);
  }
  return c;
}

try {
  assert.equal(peerIdentityDir(), home);
  const first = loadPeerIdentity().publicKey.toString("hex");
  const second = loadPeerIdentity().publicKey.toString("hex");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  console.log("[ok] CLI identity persists in configured peer home");

  assert.equal(parseArgs([]).command.kind, "help");
  assert.equal(parseArgs(["--help"]).command.kind, "help");
  assert.equal(parseArgs(["-h"]).command.kind, "help");
  assert.throws(() => parseArgs(["bogus"]), /unknown command/);
  console.log("[ok] CLI parser maps --help and rejects unknown commands");

  assert.equal(parseArgs(["keys"]).command.kind, "keys");
  console.log("[ok] CLI parser maps `keys`");

  {
    const c = parseArgs(["use", target]).command;
    assert.equal(c.kind, "use");
    if (c.kind === "use") {
      assert.equal(c.target, target);
      assert.equal(c.clear, false);
    }
  }
  {
    const c = parseArgs(["use", "--clear"]).command;
    assert.equal(c.kind, "use");
    if (c.kind === "use") assert.equal(c.clear, true);
  }
  assert.throws(() => parseArgs(["use"]), /usage: piper use/);
  assert.throws(() => parseArgs(["use", "not-a-key"]), /64-character hex/);
  console.log("[ok] CLI parser maps `use` set/clear with key validation");

  assert.deepEqual(loadPeerConfig(), {});
  savePeerConfig({ instance: target });
  assert.deepEqual(loadPeerConfig(), { instance: target });
  assert.equal(defaultInstance(), target);
  console.log("[ok] default-instance config loads and saves");

  {
    const c = oneShot(["send", "prompt", "do thing"]);
    assert.equal(c.kind, "send-prompt");
    if (c.kind === "send-prompt") {
      assert.equal(c.message, "do thing");
      assert.equal(c.behavior, "steer");
      assert.equal(c.target, target);
      assert.equal(c.stream, false);
    }
  }
  {
    const c = oneShot(["send", "prompt", "--stream", "do thing"]);
    assert.equal(c.kind, "send-prompt");
    if (c.kind === "send-prompt") {
      assert.equal(c.stream, true);
    }
  }
  {
    const c = oneShot(["send", "prompt", "--follow-up", "hi", target]);
    assert.equal(c.kind, "send-prompt");
    if (c.kind === "send-prompt") {
      assert.equal(c.message, "hi");
      assert.equal(c.behavior, "followUp");
      assert.equal(c.target, target);
      assert.equal(c.stream, false);
    }
  }
  {
    const c = oneShot(["send", "prompt", "do", "thing", "--steer", "--stream", target]);
    assert.equal(c.kind, "send-prompt");
    if (c.kind === "send-prompt") {
      assert.equal(c.message, "do thing");
      assert.equal(c.behavior, "steer");
      assert.equal(c.stream, true);
      assert.equal(c.target, target);
    }
  }
  assert.throws(() => parseArgs(["send", "prompt"]), /non-empty/);
  assert.throws(() => parseArgs(["send", "bogus"]), /usage: piper send/);
  console.log("[ok] CLI parser maps `send prompt` with --steer/--follow-up/--stream and trailing key");

  {
    const c = oneShot(["send", "steer", "focus", target]);
    assert.equal(c.kind, "send-steer");
    if (c.kind === "send-steer") {
      assert.equal(c.message, "focus");
      assert.equal(c.target, target);
    }
  }
  console.log("[ok] CLI parser maps `send steer`");

  {
    const c = oneShot(["abort", target]);
    assert.equal(c.kind, "abort");
    if (c.kind === "abort") assert.equal(c.target, target);
  }
  console.log("[ok] CLI parser maps `abort`");

  {
    const c = oneShot(["request", "get-state", target]);
    assert.equal(c.kind, "request-state");
  }
  {
    const c = oneShot(["request", "get-messages", target]);
    assert.equal(c.kind, "request-messages");
  }
  assert.throws(() => parseArgs(["request", "bogus"]), /usage: piper request/);
  console.log("[ok] CLI parser maps `request` subcommands");

  {
    const c = oneShot(["respond", "approval", "apr-1", "--allow"]);
    assert.equal(c.kind, "respond-approval");
    if (c.kind === "respond-approval") {
      assert.equal(c.id, "apr-1");
      assert.equal(c.decision, "allow");
      assert.equal(c.reason, undefined);
    }
  }
  {
    const c = oneShot(["respond", "approval", "apr-2", "--block", "--reason", "unsafe"]);
    assert.equal(c.kind, "respond-approval");
    if (c.kind === "respond-approval") {
      assert.equal(c.decision, "block");
      assert.equal(c.reason, "unsafe");
    }
  }
  assert.throws(() => parseArgs(["respond", "approval", "apr-1"]), /--allow or --block/);
  console.log("[ok] CLI parser maps `respond approval` with allow/block and reason");

  {
    const c = oneShot(["respond", "auth-result", "auth-1", "--status", "completed", "--note", "ok"]);
    assert.equal(c.kind, "respond-auth-result");
    if (c.kind === "respond-auth-result") {
      assert.equal(c.id, "auth-1");
      assert.equal(c.status, "completed");
      assert.equal(c.note, "ok");
    }
  }
  assert.throws(() => parseArgs(["respond", "auth-result", "auth-1", "--status", "bogus"]), /--status/);
  console.log("[ok] CLI parser maps `respond auth-result` with status validation");

  // --- watch: single, multi, --all ---
  {
    const c = parseArgs(["watch", target]).command;
    assert.equal(c.kind, "watch");
    if (c.kind === "watch") {
      assert.deepEqual(c.targets, [target]);
    }
  }
  {
    const c = parseArgs(["watch", target, targetB]).command;
    assert.equal(c.kind, "watch");
    if (c.kind === "watch") {
      assert.deepEqual(c.targets, [target, targetB]);
    }
  }
  {
    // --all reads from monitored list
    saveMonitoredList({ instances: [{ key: target, label: "primary" }, { key: targetB }] });
    const c = parseArgs(["watch", "--all"]).command;
    assert.equal(c.kind, "watch");
    if (c.kind === "watch") {
      assert.deepEqual(c.targets, [target, targetB]);
    }
  }
  saveMonitoredList({ instances: [] });
  assert.throws(() => parseArgs(["watch", "--all"]), /no instances/);
  console.log("[ok] CLI parser maps `watch` with one, many, or --all");

  // --- instances admin ---
  assert.deepEqual(loadMonitoredList(), { instances: [] });
  {
    const c = parseArgs(["instances", "add", target, "--label", "primary"]).command;
    assert.equal(c.kind, "instances");
    if (c.kind === "instances") {
      assert.equal(c.action, "add");
      assert.equal(c.target, target);
      assert.equal(c.label, "primary");
    }
  }
  assert.equal(parseArgs(["instances", "list"]).command.kind, "instances");
  assert.equal(parseArgs(["instances"]).command.kind, "instances");
  {
    const c = parseArgs(["instances", "remove", target]).command;
    assert.equal(c.kind, "instances");
    if (c.kind === "instances") assert.equal(c.action, "remove");
  }
  assert.throws(() => parseArgs(["instances", "add", "not-a-key"]), /64-character hex/);
  assert.throws(() => parseArgs(["instances", "bogus"]), /usage: piper instances/);
  console.log("[ok] CLI parser maps `instances` list/add/remove");

  // Corrupt monitored list does not throw, returns empty
  writeFileSync(monitoredListPath(), "{not-json");
  assert.deepEqual(loadMonitoredList(), { instances: [] });
  console.log("[ok] corrupt instances.json fails closed to empty list");

  // --- repl ---
  assert.equal(parseArgs(["repl", target]).command.kind, "repl");
  console.log("[ok] CLI parser maps `repl`");

  const savedInstance = process.env.PIPER_INSTANCE;
  process.env.PIPER_INSTANCE = "b".repeat(64);
  assert.equal(defaultInstance(), "b".repeat(64));
  process.env.PIPER_INSTANCE = savedInstance;
  console.log("[ok] PIPER_INSTANCE env var overrides saved default");

  writeFileSync(join(home, "config.json"), "{not-json");
  assert.deepEqual(loadPeerConfig(), {});
  console.log("[ok] corrupt config.json fails closed to empty config");

  // buildRequest
  const senderCases: Array<[string, OneShot]> = [
    ["send prompt", oneShot(["send", "prompt", "hi", target])],
    ["send steer", oneShot(["send", "steer", "x", target])],
    ["abort", oneShot(["abort", target])],
    ["get-state", oneShot(["request", "get-state", target])],
    ["get-messages", oneShot(["request", "get-messages", target])],
  ];
  for (const [label, cmd] of senderCases) {
    const req = buildRequest(cmd, "id-1");
    assert.ok(req && typeof req === "object" && "t" in req, `${label} produced a request`);
    assert.equal((req as { id?: string }).id, "id-1", `${label} preserves caller-supplied id`);
  }
  {
    const cmd = oneShot(["respond", "approval", "apr-1", "--allow"]);
    const req = buildRequest(cmd, "ignored");
    assert.equal((req as { id?: string }).id, "apr-1");
  }
  {
    const cmd = oneShot(["respond", "auth-result", "auth-1", "--status", "completed"]);
    const req = buildRequest(cmd, "ignored");
    assert.equal((req as { id?: string }).id, "auth-1");
  }
  // --stream on send prompt doesn't change the wire message; it only changes runtime
  {
    const cmd = oneShot(["send", "prompt", "--stream", "hi", target]);
    const req = buildRequest(cmd, "id-1");
    assert.equal((req as { t: string }).t, "prompt");
    assert.equal((req as { id?: string }).id, "id-1");
  }
  console.log("[ok] buildRequest uses caller-supplied id for sends, approval-id for responses, --stream is runtime-only");

  // --- JSON formatter ---
  const stdoutCaptured: string[] = [];
  const stderrCaptured: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdoutCaptured.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderrCaptured.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const fmt = makeFormatter(true);
    fmt.emit({ t: "info", message: "hello" });
    fmt.emit({ t: "session", state: "open", peerKey: target, instanceKey: targetB, instanceLabel: "cloud" });
    fmt.emit({ t: "session", state: "reconnecting", instanceKey: target, attempt: 2, maxAttempts: 5, delayMs: 4000 });
    fmt.emit({ t: "auth_request_hint", id: "auth-1", instanceKey: target, domain: "example.com", reason: "needs login" });
    fmt.emit({ t: "response", id: "r1", ok: true, data: { hello: "world" }, instanceKey: target, instanceLabel: "cloud" });
    fmt.error("bad");
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
  assert.equal(stdoutCaptured.length, 5);
  assert.equal(stderrCaptured.length, 1);
  for (const line of stdoutCaptured) assert.match(line.trim(), /^\{.+\}$/);
  for (const line of stderrCaptured) assert.match(line.trim(), /^\{.+\}$/);
  const outParsed = stdoutCaptured.map((l) => JSON.parse(l.trim()));
  const errParsed = stderrCaptured.map((l) => JSON.parse(l.trim()));
  assert.equal(outParsed[0].message, "hello");
  assert.equal(outParsed[1].instanceLabel, "cloud");
  assert.equal(outParsed[2].attempt, 2);
  assert.equal(outParsed[3].id, "auth-1");
  assert.equal(outParsed[3].domain, "example.com");
  assert.equal(outParsed[4].ok, true);
  assert.equal(errParsed[0].reason, "bad");
  console.log("[ok] --json formatter emits one parseable line per emit (stdout for events, stderr for errors)");

  for (const s of ["completed", "failed", "expired", "cancelled", "rejected"]) {
    assert.ok(AUTH_RESULT_STATUSES.has(s as (typeof AUTH_RESULT_STATUSES extends Set<infer T> ? T : never)));
  }
  console.log("[ok] AUTH_RESULT_STATUSES contains the five expected values");
} finally {
  rmSync(home, { recursive: true, force: true });
  if (savedBootstrap === undefined) delete process.env.PIPER_BOOTSTRAP;
  else process.env.PIPER_BOOTSTRAP = savedBootstrap;
}

console.log("\nCLI CHECKS PASSED");
