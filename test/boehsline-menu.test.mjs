import assert from "node:assert/strict";
import { test } from "node:test";
import { optIns } from "../lib/config.ts";
import { menuItems } from "../extensions/boehsline.ts";

test("menu: one on/off row per opt-in, sorted, then the two actions", () => {
	optIns().set("zeta", { name: "zeta", description: "Z", on: false });
	optIns().set("alpha", { name: "alpha", description: "A", on: true });
	try {
		const items = menuItems(3);
		assert.deepEqual(items.map((i) => i.id), ["opt:alpha", "opt:zeta", "defaults", "config"]);
		assert.equal(items[0].currentValue, "on");
		assert.deepEqual(items[1].values, ["on", "off"]);
		assert.equal(items[2].currentValue, "3 to add");
		assert.equal(items[2].values, undefined, "an action, not a cycle");
		assert.equal(menuItems(0)[2].currentValue, "applied");
		assert.equal(new Set(items.map((i) => i.label.length)).size, 1, "labels line up");
	} finally {
		optIns().delete("zeta");
		optIns().delete("alpha");
	}
});

test("bundled packages: loaded when one of their files registered a command", async () => {
	const { bundledPackages } = await import("../extensions/boehsline.ts");
	const root = new URL("..", import.meta.url).pathname;
	const pkgs = bundledPackages([
		{ name: "context", sourceInfo: { path: `${root}packages/context/index.ts` } },
		{ name: "approval-guardian", sourceInfo: { path: `${root}extensions/opt-in/approval-guardian.ts` } },
		{ name: "stash", sourceInfo: { path: `${root}extensions/stash.ts` } },
	]);
	assert.deepEqual(pkgs.map((p) => p.dir), ["agent-link", "approval-guardian", "context", "goal", "scheduler"]);
	const by = Object.fromEntries(pkgs.map((p) => [p.dir, p]));
	assert.deepEqual(by.context.commands, ["/context"]);
	assert.equal(by["approval-guardian"].loaded, true, "through its opt-in wrapper");
	assert.equal(by.goal.loaded, false);
	assert.match(by.scheduler.version, /^\d+\.\d+\.\d+$/);
	assert.equal(by.scheduler.name, "pi-scheduler");
	const row = menuItems(0, pkgs).find((i) => i.id === "packages");
	assert.equal(row.currentValue, "2 of 5 loaded");
	assert.deepEqual(bundledPackages([], "/nonexistent"), []);
});
