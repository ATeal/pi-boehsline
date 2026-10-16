import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import {
	enabled,
	loadConfig,
	merge,
	readUserConfig,
	registerSource,
	settingsFor,
	setEnabled,
	sources,
	SOURCES_KEY,
} from "../lib/config.ts";

beforeEach(() => sources().clear());

test("merge: objects deep-merge, arrays and scalars replace", () => {
	assert.deepEqual(merge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, d: 2 }), { a: { b: 1, c: [3] }, d: 2 });
});

test("comment keys (//) are dropped at every level", () => {
	registerSource("acme", { "//": "note", watch: { "// why": "x", a: 1 } });
	assert.deepEqual(loadConfig({ "//": "mine" }), { watch: { a: 1 }, enable: [] });
});

test("precedence: source < user file", () => {
	registerSource("acme", { watch: { workspaces: ["acme"], scout: "haiku" } });
	const config = loadConfig({ watch: { scout: "sonnet" } });
	assert.deepEqual(config.watch, { workspaces: ["acme"], scout: "sonnet" });
});

test("sources cannot enable; only the user file can", () => {
	registerSource("acme", { enable: ["watch"] });
	assert.equal(enabled("watch", loadConfig({})), false);
	assert.equal(enabled("watch", loadConfig({ enable: ["watch"] })), true);
});

test("a source registered without importing Boehsline (the documented contract) is seen", () => {
	(globalThis[Symbol.for("boehsline.config.sources")] ??= new Map()).set("raw", { x: { y: 1 } });
	assert.equal(SOURCES_KEY, Symbol.for("boehsline.config.sources"));
	assert.deepEqual(loadConfig({}).x, { y: 1 });
});

test("re-registering a source replaces it (reload safe)", () => {
	registerSource("acme", { a: 1 });
	registerSource("acme", { a: 2 });
	assert.equal(sources().size, 1);
	assert.equal(loadConfig({}).a, 2);
});

test("settingsFor merges the block over defaults", () => {
	registerSource("acme", { meeting: { qmd: ["wiki", "team-docs"] } });
	assert.deepEqual(settingsFor("meeting", { qmd: ["wiki"], model: "x" }, loadConfig({})), {
		qmd: ["wiki", "team-docs"],
		model: "x",
	});
	assert.deepEqual(settingsFor("missing", { a: 1 }, loadConfig({})), { a: 1 });
});

test("readUserConfig: missing file is empty, broken file is reported", () => {
	const dir = mkdtempSync(join(tmpdir(), "boehsline-"));
	assert.deepEqual(readUserConfig(join(dir, "nope.json")), { config: {} });
	writeFileSync(join(dir, "bad.json"), "{nope");
	assert.match(readUserConfig(join(dir, "bad.json")).error ?? "", /bad\.json/);
	writeFileSync(join(dir, "arr.json"), "[]");
	assert.match(readUserConfig(join(dir, "arr.json")).error ?? "", /object/);
});

test("setEnabled adds and removes, keeps other keys, refuses broken files", () => {
	const dir = mkdtempSync(join(tmpdir(), "boehsline-"));
	const path = join(dir, "sub", "boehsline.json");
	assert.deepEqual(setEnabled("watch", true, path), ["watch"]);
	writeFileSync(path, JSON.stringify({ enable: ["watch"], watch: { a: 1 } }));
	assert.deepEqual(setEnabled("omlx", true, path), ["omlx", "watch"]);
	assert.deepEqual(setEnabled("watch", false, path), ["omlx"]);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).watch, { a: 1 });
	writeFileSync(path, "{broken");
	assert.throws(() => setEnabled("x", true, path), /broken/);
});

test("BOEHSLINE_ENABLE adds to the user file's enable list", () => {
	const prev = process.env.BOEHSLINE_ENABLE;
	try {
		process.env.BOEHSLINE_ENABLE = " omlx , sc,";
		assert.deepEqual(loadConfig({ enable: ["sc", "watch"] }).enable, ["sc", "watch", "omlx"]);
	} finally {
		if (prev === undefined) delete process.env.BOEHSLINE_ENABLE;
		else process.env.BOEHSLINE_ENABLE = prev;
	}
});
