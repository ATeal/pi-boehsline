import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stubCtx, stubPi } from "./helpers/stub-pi.mjs";

// No mise config under this HOME, and the agent dir (update-check.json) is a temp one too.
const home = mkdtempSync(join(tmpdir(), "update-home-"));
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = home;
const config = join(home, "boehsline.json");
process.env.BOEHSLINE_CONFIG = config;
process.env.BOEHSLINE_ENABLE = "update";
delete process.env.PI_SKIP_VERSION_CHECK;
delete process.env.PI_OFFLINE;

const { default: update, projectRoot } = await import("../extensions/opt-in/update.ts");

test("update registers /update, the banner renderer and a startup check; it silences pi's own check", () => {
	const s = stubPi();
	update(s.pi);
	assert.deepEqual(s.names(), ["command:update", "on:session_start", "renderer:pi-update-available"]);
	assert.equal(process.env.PI_SKIP_VERSION_CHECK, "1");
	const complete = s.commands.get("update").getArgumentCompletions;
	assert.deepEqual(complete("ch").map((i) => i.value), ["check"]);
	assert.deepEqual(complete("x"), []);
});

test("the banner renders only with a version", () => {
	const s = stubPi();
	update(s.pi);
	const render = s.renderers.get("pi-update-available");
	const theme = { fg: (_c, t) => t, bold: (t) => t };
	assert.equal(render({ details: {} }, {}, theme), undefined);
	assert.ok(render({ details: { version: "9.9.9" } }, {}, theme), "a component for a real version");
});

test("/update without a mise project says how to set update.dir; with one, projectRoot finds it", async () => {
	const s = stubPi();
	update(s.pi);
	const { ctx, notes } = stubCtx();
	await s.commands.get("update").handler("check", ctx);
	assert.equal(notes.at(-1)[0], "error");
	assert.match(notes.at(-1)[1], /"update": \{ "dir"/);
	writeFileSync(config, JSON.stringify({ update: { dir: home } }));
	assert.equal(await projectRoot(), home, "not a git checkout, so the dir itself");
});

test("no UI: the startup check does nothing", async () => {
	const s = stubPi();
	update(s.pi);
	await s.fire("session_start", {}, stubCtx({ hasUI: false }).ctx);
	assert.equal(s.sent.length, 0);
});
