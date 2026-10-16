import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changes, diffText, planDefaults, readFlat, SHORTCUT_CONFLICTS, unresolvedConflicts } from "../lib/defaults.ts";

const shipped = readFlat(new URL("../defaults/keybindings.json", import.meta.url).pathname);

test("only fills missing keys; yours are kept unless --force", () => {
	const user = { "app.models.save": "ctrl+shift+s", "tui.editor.undo": ["ctrl+-", "super+z"], "mine.only": "x" };
	const plan = planDefaults(user, { "//": "comment", "app.models.save": "alt+s", "app.session.rename": "alt+r", "tui.editor.undo": ["ctrl+-", "super+z"] });
	assert.deepEqual(plan.add, [["app.session.rename", "alt+r"]]);
	assert.deepEqual(plan.change, [["app.models.save", "ctrl+shift+s", "alt+s"]]);
	assert.equal(plan.merged["app.models.save"], "ctrl+shift+s", "kept without force");
	assert.equal(plan.merged["mine.only"], "x", "nothing removed");
	assert.ok(!("//" in plan.merged), "comment keys never land in your file");
	assert.equal(planDefaults(user, { "app.models.save": "alt+s" }, true).merged["app.models.save"], "alt+s");
});

test("the diff reads +add, = kept, ~ replaced", () => {
	const plan = planDefaults({ a: 1 }, { a: 2, b: [3] });
	assert.equal(diffText(plan, false), '+ b: [3]\n= a: keeping 1 (default 2; --force replaces)');
	assert.equal(diffText(planDefaults({ a: 1 }, { a: 2 }, true), true), "~ a: 1 → 2");
	assert.equal(changes(planDefaults({ a: 1 }, { a: 2 }), false), false, "a kept difference alone writes nothing");
	assert.equal(changes(planDefaults({}, { a: 1 }), false), true);
});

test("the shipped keybindings resolve every known conflict", () => {
	assert.deepEqual(unresolvedConflicts({}), [{ key: "Ctrl+S", by: "stash" }, { key: "Ctrl+R", by: "prompt-history" }]);
	assert.deepEqual(unresolvedConflicts({ "app.models.save": "alt+s", "app.session.rename": "alt+r" }), [{ key: "Ctrl+S", by: "stash" }], "Ctrl+S has more than one pi action");
	assert.deepEqual(unresolvedConflicts(planDefaults({}, shipped).merged), []);
	for (const c of SHORTCUT_CONFLICTS) assert.ok(c.action in shipped, c.action);
});

test("readFlat: missing is {}, broken throws", () => {
	const dir = mkdtempSync(join(tmpdir(), "defaults-"));
	assert.deepEqual(readFlat(join(dir, "none.json")), {});
	writeFileSync(join(dir, "bad.json"), "[1]");
	assert.throws(() => readFlat(join(dir, "bad.json")), /object/);
});
