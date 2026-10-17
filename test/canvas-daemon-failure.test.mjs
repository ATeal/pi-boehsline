// A canvas daemon that can't start must not take pi down with it.
//
// ensureDaemon is fired and forgotten (session_start, every canvas write), and
// pi exits on an unhandled rejection. So a canvas root that can't be created,
// or a spawn that fails, has to resolve false rather than reject.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

// A port nothing answers on, so ensureDaemon gets past /health to the start.
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("ensureDaemon resolves false, without an unhandled rejection, when the canvas root can't be created", async () => {
  const script = `
    process.on("unhandledRejection", (error) => { console.log("UNHANDLED " + error); process.exit(3); });
    const { ensureDaemon } = await import(${JSON.stringify(`${root}extensions/canvas/index.ts`)});
    const results = [await ensureDaemon(), await ensureDaemon()];
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log("RESULT " + results.join(","));
  `;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    // /dev/null is a file, so mkdir under it fails with ENOTDIR.
    env: { ...process.env, PI_CANVAS_PORT: String(await freePort()), PI_CANVAS_ROOT: "/dev/null/canvas" },
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /RESULT false,false/, "both attempts, the second after the first settled");
  assert.doesNotMatch(run.stdout, /UNHANDLED/);
});

test("a daemon that finds its port taken says so in the log and leaves no pid file", async () => {
  const { mkdtempSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  // Another program holds the port.
  const holder = createServer();
  await new Promise((resolve) => holder.listen(0, "127.0.0.1", resolve));
  const { port } = holder.address();
  const canvasRoot = mkdtempSync(join(tmpdir(), "canvas-eaddrinuse-"));
  try {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [`${root}extensions/canvas/daemon.mjs`, "--port", String(port), "--root", canvasRoot, "--version", "test"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 0, "losing the race isn't a crash");
    assert.match(stderr, new RegExp(`port ${port} is in use \\(another canvas daemon, or another program\\); exiting`));
    assert.equal(existsSync(join(canvasRoot, ".daemon.json")), false, "no pid of a process that is gone");
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});
