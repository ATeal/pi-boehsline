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
