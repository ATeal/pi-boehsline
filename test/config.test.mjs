import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import {
	enabled,
	loadConfig,
	merge,
	parseJsonc,
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

test("the user file may be JSONC: comments and trailing commas, strings untouched", () => {
	assert.deepEqual(parseJsonc('{ "a": "http://x//y", // c\n "b": [1, 2,], /* x */ "c": "q\\"//\\"", }'), { a: "http://x//y", b: [1, 2], c: 'q"//"' });
	assert.deepEqual(parseJsonc('{ "s": "a,}", "t": "/* not */" }'), { s: "a,}", t: "/* not */" });
	assert.throws(() => parseJsonc("{ nope }"));
	// The README's configuration example, pasted as is.
	const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
	const example = readme.match(/## Configuration reference[\s\S]*?```json[c]?\n([\s\S]*?)```/)[1];
	assert.ok(Array.isArray(parseJsonc(example).enable), "README example parses");
	const dir = mkdtempSync(join(tmpdir(), "boehsline-"));
	writeFileSync(join(dir, "c.json"), '{\n  // opt-ins\n  "enable": ["watch"],\n}\n');
	assert.deepEqual(readUserConfig(join(dir, "c.json")).config, { enable: ["watch"] });
});

test("setEnabled keeps a commented file's comments, editing only enable", () => {
	const dir = mkdtempSync(join(tmpdir(), "boehsline-"));
	const path = join(dir, "boehsline.json");
	writeFileSync(path, '{\n  // my opt-ins\n  "enable": ["watch"], // keep\n  "watch": { "vips": ["Sam"] },\n}\n');
	assert.deepEqual(setEnabled("meeting", true, path), ["meeting", "watch"]);
	assert.equal(readFileSync(path, "utf8"), '{\n  // my opt-ins\n  "enable": ["meeting","watch"], // keep\n  "watch": { "vips": ["Sam"] },\n}\n');
	// No enable list yet: added after the opening brace.
	writeFileSync(path, '{\n  // nothing yet\n  "watch": {},\n}\n');
	setEnabled("omlx", true, path);
	assert.match(readFileSync(path, "utf8"), /^\{\n  "enable": \["omlx"\],\n  \/\/ nothing yet\n/);
	assert.deepEqual(readUserConfig(path).config, { enable: ["omlx"], watch: {} });
	// An enable mentioned only in a comment isn't the one edited.
	writeFileSync(path, '{\n  // "enable": ["old"]\n  "enable": ["a"]\n}\n');
	assert.throws(() => setEnabled("b", true, path), /by hand/);
	assert.match(readFileSync(path, "utf8"), /"enable": \["a"\]/, "left as it was");
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

test("userConfigPath: BOEHSLINE_CONFIG, else pi's agent dir (PI_CODING_AGENT_DIR), else ~/.pi/agent", async () => {
	const { userConfigPath } = await import("../lib/config.ts");
	assert.equal(userConfigPath({ BOEHSLINE_CONFIG: "/x/b.json", PI_CODING_AGENT_DIR: "/a" }), "/x/b.json");
	assert.equal(userConfigPath({ PI_CODING_AGENT_DIR: "/a" }), "/a/boehsline.json");
	assert.match(userConfigPath({}), /\.pi\/agent\/boehsline\.json$/);
});

test("setEnabled writes through a symlinked config and keeps the link", async () => {
	const { lstatSync, symlinkSync } = await import("node:fs");
	const dir = mkdtempSync(join(tmpdir(), "boehsline-"));
	const real = join(dir, "dotfiles-boehsline.json");
	writeFileSync(real, JSON.stringify({ enable: [], watch: { a: 1 } }));
	const link = join(dir, "boehsline.json");
	symlinkSync(real, link);
	setEnabled("watch", true, link);
	assert.ok(lstatSync(link).isSymbolicLink(), "still a link");
	assert.deepEqual(JSON.parse(readFileSync(real, "utf8")), { enable: ["watch"], watch: { a: 1 } });
});
