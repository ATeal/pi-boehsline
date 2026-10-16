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
