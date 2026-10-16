import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const dirs = (rel) => readdirSync(`${root}${rel}`, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const core = dirs("extensions").filter((d) => d !== "opt-in");
const optIns = dirs("extensions/opt-in");
const index = readFileSync(`${root}README.md`, "utf8");

test("every extension is a folder with index.ts and a README titled with its name", () => {
	for (const [rel, names] of [["extensions", core], ["extensions/opt-in", optIns]]) {
		for (const name of names) {
			assert.ok(existsSync(`${root}${rel}/${name}/index.ts`), `${rel}/${name}/index.ts`);
			const readme = `${root}${rel}/${name}/README.md`;
			assert.ok(existsSync(readme), `${rel}/${name}/README.md`);
			assert.match(readFileSync(readme, "utf8"), new RegExp(`^# ${name}\\n`), `${name}'s README starts with "# ${name}"`);
		}
	}
});

test("opt-in READMEs say how to turn them on", () => {
	for (const name of optIns) {
		assert.match(readFileSync(`${root}extensions/opt-in/${name}/README.md`, "utf8"), new RegExp(`/boehsline enable ${name}\\b`), name);
	}
});

test("the root README links every extension's README", () => {
	for (const name of core) assert.ok(index.includes(`(extensions/${name}/README.md)`), name);
	for (const name of optIns) assert.ok(index.includes(`(extensions/opt-in/${name}/README.md)`), name);
});
