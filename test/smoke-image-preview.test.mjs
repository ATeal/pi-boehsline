import assert from "node:assert/strict";
import { test } from "node:test";
import { stubCtx, stubPi } from "./helpers/stub-pi.mjs";

const { default: imagePreview } = await import("../extensions/image-preview/index.ts");

test("image-preview registers /preview and its hooks; session_start wraps read", async () => {
	const s = stubPi();
	imagePreview(s.pi);
	assert.deepEqual(s.names(), ["command:preview", "on:session_start", "on:tool_result"]);
	await s.fire("session_start", {}, stubCtx().ctx);
	assert.deepEqual(s.tools.map((t) => t.name), ["read"], "the built-in read, re-registered with an image renderer");
	assert.equal(typeof s.tools[0].execute, "function", "keeps read's own execute");
	assert.equal(typeof s.tools[0].renderResult, "function");
});

test("/preview: nothing read yet, then a remembered image that's gone", async () => {
	const s = stubPi();
	imagePreview(s.pi);
	const { ctx, notes } = stubCtx();
	await s.commands.get("preview").handler("", ctx);
	assert.match(notes.at(-1)[1], /No image read yet/);
	// A read that returned an image is remembered for a bare /preview.
	await s.fire("tool_result", { toolName: "read", input: { path: "/nonexistent/shot.png" }, content: [{ type: "image" }] }, ctx);
	await s.commands.get("preview").handler("", ctx);
	assert.deepEqual(notes.at(-1), ["error", "File not found: /nonexistent/shot.png"]);
	// A read without an image doesn't replace it.
	await s.fire("tool_result", { toolName: "read", input: { path: "/nonexistent/a.txt" }, content: [{ type: "text" }] }, ctx);
	await s.commands.get("preview").handler("", ctx);
	assert.match(notes.at(-1)[1], /shot\.png$/);
});
