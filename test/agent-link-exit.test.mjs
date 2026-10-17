/**
 * A pi that exits hard (process.exit in a print-mode probe, as scripts/bench.mjs
 * does) skips session_shutdown. agent-link's exit hook calls deregisterPeerSync
 * so its ~/.claude/sessions/<pid>.json doesn't linger, to be read as the name of
 * whichever process later reuses the pid.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// CLAUDE_REGISTRY is fixed from HOME at import.
const home = mkdtempSync(join(tmpdir(), "agent-link-exit-"));
process.env.HOME = home;
const registry = join(home, ".claude", "sessions");
mkdirSync(registry, { recursive: true });
const protocol = new URL("../packages/agent-link/claude-protocol.ts", import.meta.url).pathname;
const { deregisterPeerSync } = await import(protocol);

test("removes this process's registry file and socket", () => {
  const file = join(registry, "4242.json");
  const sock = join(home, "4242.sock");
  writeFileSync(file, JSON.stringify({ pid: 4242, messagingSocketPath: sock }));
  writeFileSync(sock, "");
  deregisterPeerSync(4242, sock);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(sock), false);
});

test("leaves a file another process has since written for the same pid", () => {
  const file = join(registry, "4343.json");
  writeFileSync(file, JSON.stringify({ pid: 4343, messagingSocketPath: "/tmp/someone-else.sock" }));
  deregisterPeerSync(4343, join(home, "4343.sock"));
  assert.equal(existsSync(file), true);
});

test("a process that registers and then calls process.exit leaves no registry file", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { registerPeer, deregisterPeerSync } = await import(${JSON.stringify(protocol)});
    const sock = ${JSON.stringify(join(home, "child.sock"))};
    await registerPeer({ pid: process.pid, name: "pi-child", cwd: "/tmp", sockPath: sock });
    process.once("exit", () => deregisterPeerSync(process.pid, sock));
    console.log(process.pid);
    process.exit(0);
  `], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const pid = child.stdout.trim();
  assert.ok(pid, "child printed its pid");
  assert.equal(existsSync(join(registry, `${pid}.json`)), false);
});
