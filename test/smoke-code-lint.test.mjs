import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stubCtx, stubPi } from "./helpers/stub-pi.mjs";

const { default: codeLint } = await import("../extensions/code-lint/index.ts");

test("code-lint registers one tool_result hook", () => {
	const s = stubPi();
	codeLint(s.pi);
	assert.deepEqual(s.names(), ["on:tool_result"]);
});

test("code-lint leaves reads, failed writes and pathless calls alone", async () => {
	const s = stubPi();
	codeLint(s.pi);
	const { ctx } = stubCtx();
	const content = [{ type: "text", text: "ok" }];
	assert.deepEqual(await s.fire("tool_result", { toolName: "read", input: { path: "x.rb" }, content }, ctx), [undefined]);
	assert.deepEqual(await s.fire("tool_result", { toolName: "write", isError: true, input: { path: "x.rb" }, content }, ctx), [undefined]);
	assert.deepEqual(await s.fire("tool_result", { toolName: "edit", input: {}, content }, ctx), [undefined]);
});

test("code-lint: a write no linter cares about adds nothing", async () => {
	const dir = mkdtempSync(join(tmpdir(), "code-lint-"));
	const file = join(dir, "notes.txt");
	writeFileSync(file, "plain text\n");
	const s = stubPi();
	codeLint(s.pi);
	const { ctx } = stubCtx({ cwd: dir });
	const [result] = await s.fire("tool_result", { toolName: "write", input: { path: file }, content: [] }, ctx);
	assert.equal(result, undefined, "lint.sh ran and exited 0");
});
