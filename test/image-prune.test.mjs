import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { drafts, saveImage, status } from "../extensions/opt-in/image-prune/index.ts";
import {
	base64Bytes,
	decodedBytes,
	extensionFor,
	normalize,
	note,
	plan,
	replaceImages,
	scan,
	toolCallPaths,
	turnCutoff,
} from "../extensions/opt-in/image-prune/prune.ts";

const MB = 1024 * 1024;
const SETTINGS = { enabled: true, thresholdMB: 5, keepTurns: 2 };

/** An image whose base64 is `bytes` characters long. */
const image = (bytes, mimeType = "image/png") => ({ type: "image", data: "A".repeat(bytes), mimeType });
const text = (t) => ({ type: "text", text: t });

let seq = 0;
/** A projected message entry, the shape buildSessionProjection() returns. */
function entry(message, type = "message") {
	const id = `e${++seq}`;
	const sourceEntry = type === "message" ? { type, id, message } : { type, id, customType: "x", content: message.content, display: true };
	return { sourceEntry, messages: [message] };
}
const user = (...content) => entry({ role: "user", content });
const assistant = (...content) => entry({ role: "assistant", content });
const toolResult = (toolCallId, content, extra = {}) => entry({ role: "toolResult", toolCallId, toolName: "read", content, ...extra });
const call = (id, args) => ({ type: "toolCall", id, name: "read", arguments: args });

test("settings: bad values fall back to the defaults", () => {
	assert.deepEqual(normalize({}), SETTINGS);
	assert.deepEqual(normalize({ enabled: false, thresholdMB: 2.5, keepTurns: 3.9 }), { enabled: false, thresholdMB: 2.5, keepTurns: 3 });
	assert.deepEqual(normalize({ thresholdMB: "9", keepTurns: -1 }), SETTINGS);
});

test("sizes: base64 characters on the wire, decoded size for the note", () => {
	assert.equal(base64Bytes([image(100), image(50)]), 150);
	assert.equal(decodedBytes({ type: "image", data: "AAAA", mimeType: "image/png" }), 3);
	assert.equal(decodedBytes({ type: "image", data: "AA==", mimeType: "image/png" }), 1);
	assert.equal(extensionFor("image/jpeg"), "jpg");
	assert.equal(extensionFor("image/png"), "png");
	assert.equal(extensionFor("image/svg+xml"), "svg");
	assert.equal(extensionFor("weird"), "bin");
});

test("turnCutoff: where the last keepTurns user turns start", () => {
	const entries = [user(text("1")), assistant(text("a")), user(text("2")), assistant(text("b")), user(text("3")), assistant(text("c"))];
	assert.equal(turnCutoff(entries, 1), 4);
	assert.equal(turnCutoff(entries, 2), 2);
	assert.equal(turnCutoff(entries, 3), 0);
	assert.equal(turnCutoff(entries, 9), 0, "fewer turns than keepTurns keeps everything");
	assert.equal(turnCutoff(entries, 0), entries.length, "keepTurns 0 makes everything prunable");
});

test("scan: counts every visible image, marks the old ones prunable", () => {
	const entries = [
		user(text("look"), image(1000)),
		assistant(call("c1", { path: "a.png" })),
		toolResult("c1", [text("Read image file [image/png]"), image(2000)]),
		user(text("again"), image(300)),
		assistant(text("ok")),
		user(text("now")),
	];
	const s = scan(entries, 2);
	assert.equal(s.totalBytes, 3300);
	assert.equal(s.count, 3);
	assert.equal(s.prunableBytes, 3000);
	assert.equal(s.prunableCount, 2);
	assert.deepEqual(s.entries.filter((e) => e.prunable).map((e) => e.role), ["user", "toolResult"]);
});

test("scan: a compaction's checkpoint and omitted entries aren't targets", () => {
	const compaction = { sourceEntry: { type: "compaction", id: "c" }, messages: [{ role: "system", content: "sys" }, { role: "compactionSummary", summary: "s" }] };
	const omitted = { sourceEntry: { type: "message", id: "gone", message: { role: "user", content: [image(5000)] } }, messages: [] };
	const s = scan([compaction, omitted, user(image(10)), user(text("a")), user(text("b"))], 2);
	assert.equal(s.totalBytes, 10, "an omitted entry sends nothing");
	assert.deepEqual(s.entries.map((e) => e.prunable), [true]);
});

test("plan: under the threshold, nothing", () => {
	const entries = [user(image(1 * MB)), user(text("a")), user(text("b"))];
	const p = plan(entries, SETTINGS);
	assert.equal(p.fire, false);
	assert.match(p.reason, /under the 5 MB threshold/);
});

test("plan: over the threshold, every old image in one batch, recent turns kept", () => {
	const entries = [
		user(text("first"), image(2 * MB)),
		assistant(call("c1", { path: "x.png" })),
		toolResult("c1", [image(2 * MB)]),
		toolResult("c2", [text("boom"), image(1 * MB)], { isError: true }),
		user(text("second"), image(512 * 1024)),
		assistant(text("ok")),
		user(text("third")),
	];
	const p = plan(entries, SETTINGS);
	assert.equal(p.fire, true);
	assert.deepEqual(p.targets.map((t) => t.entryId), [entries[0], entries[2], entries[3]].map((e) => e.sourceEntry.id));
	// Once pruned, the visible bytes are well under the threshold.
	assert.ok(p.scan.totalBytes - p.targets.reduce((n, t) => n + t.bytes, 0) < 5 * MB);
});

test("plan: recent images alone over the threshold don't trigger a trickle of edits", () => {
	const entries = [user(text("old"), image(100 * 1024)), user(text("a"), image(6 * MB)), user(text("b"))];
	const p = plan(entries, SETTINGS);
	assert.equal(p.fire, false);
	assert.match(p.reason, /waiting for more/);
});

test("plan: force ignores threshold and enabled, still keeps recent turns", () => {
	const entries = [user(image(10)), user(text("a"), image(20)), user(text("b"))];
	const p = plan(entries, { ...SETTINGS, enabled: false }, true);
	assert.equal(p.fire, true);
	assert.equal(p.targets.length, 1);
	assert.equal(plan([user(image(10)), user(text("a"))], SETTINGS, true).fire, false, "nothing older than keepTurns");
});

test("plan: disabled never fires on its own", () => {
	const entries = [user(image(6 * MB)), user(text("a")), user(text("b"))];
	assert.equal(plan(entries, { ...SETTINGS, enabled: false }).fire, false);
	assert.equal(plan(entries, SETTINGS).fire, true);
});

test("note: path, type, size and how to get it back", () => {
	const img = image(4096 * 4 / 3);
	assert.equal(note(img, "/tmp/a.png"), "[image removed to save context: /tmp/a.png, image/png, ~4 KB. Use the read tool on the path to view it again.]");
	assert.match(note(img, undefined), /^\[image removed to save context: pasted image, image\/png, ~4 KB\. It wasn't saved/);
});

test("replaceImages: text kept in order, each image becomes its note", () => {
	const content = [text("before"), image(400), text("between"), image(400, "image/jpeg")];
	const out = replaceImages(content, (img, n) => `/p/${n}.${extensionFor(img.mimeType)}`);
	assert.deepEqual(out.map((b) => b.type), ["text", "text", "text", "text"]);
	assert.equal(out[0], content[0]);
	assert.equal(out[2], content[2]);
	assert.match(out[1].text, /\/p\/0\.png, image\/png/);
	assert.match(out[3].text, /\/p\/1\.jpg, image\/jpeg/);
	assert.ok(!JSON.stringify(out).includes("AAAA"));
});

test("toolCallPaths: path, file_path or filePath from assistant tool calls", () => {
	const entries = [assistant(call("a", { path: "x.png" }), call("b", { file_path: "/y.png" }), call("c", { command: "ls" })), assistant(call("d", { filePath: "z.jpg" }))];
	assert.deepEqual([...toolCallPaths(entries)], [["a", "x.png"], ["b", "/y.png"], ["d", "z.jpg"]]);
});

test("drafts: read results point at their file, pasted images are saved", () => {
	const dir = mkdtempSync(join(tmpdir(), "image-prune-"));
	writeFileSync(join(dir, "shot.png"), "png");
	const pasted = image(8);
	const entries = [
		user(text("see"), pasted),
		assistant(call("c1", { path: "shot.png" }), call("c2", { path: "missing.png" })),
		toolResult("c1", [text("Read image file [image/png]"), image(16)]),
		toolResult("c2", [image(24)]),
		user(text("a")),
		user(text("b")),
	];
	const saved = [];
	const p = plan(entries, SETTINGS, true);
	const out = drafts(entries, p.targets, dir, (img) => (saved.push(img), `/saved/${saved.length}.png`));
	assert.deepEqual(out.map((d) => [d.type, d.targetId]), [entries[0], entries[2], entries[3]].map((e) => ["context_edit", e.sourceEntry.id]));
	assert.equal(out[0].replacement.content[0].text, "see");
	assert.match(out[0].replacement.content[1].text, /: \/saved\/1\.png,/);
	assert.match(out[1].replacement.content[1].text, new RegExp(`: ${join(dir, "shot.png")},`), "the read tool's own path");
	assert.match(out[2].replacement.content[0].text, /: \/saved\/2\.png,/, "file gone: saved instead");
	assert.deepEqual(saved, [pasted, entries[3].messages[0].content[0]]);
});

test("drafts: custom messages with images are edited too", () => {
	const custom = entry({ role: "custom", customType: "x", content: [text("hi"), image(10)] }, "custom_message");
	const entries = [custom, user(text("a")), user(text("b"))];
	const out = drafts(entries, plan(entries, SETTINGS, true).targets, "/", () => "/s.png");
	assert.equal(out[0].targetId, custom.sourceEntry.id);
	assert.match(out[0].replacement.content[1].text, /\/s\.png/);
});

test("saveImage: content-addressed file under the save dir", () => {
	const dir = mkdtempSync(join(tmpdir(), "image-prune-save-"));
	const img = { type: "image", data: Buffer.from("hello").toString("base64"), mimeType: "image/jpeg" };
	const path = saveImage(img, dir);
	assert.match(path, /\/[0-9a-f]{16}\.jpg$/);
	assert.equal(readFileSync(path, "utf8"), "hello");
	assert.equal(saveImage(img, dir), path);
	assert.ok(existsSync(path));
});

test("status: what /image-prune shows", () => {
	const entries = [user(image(2048)), user(text("a")), user(text("b"))];
	const out = status({ sessionManager: { buildSessionProjection: () => ({ entries }) } }, SETTINGS);
	assert.match(out, /1 image in context, 2 KB sent with every request/);
	assert.match(out, /older than the last 2 user turns: 1 \(2 KB\)/);
	assert.match(out, /threshold 5 MB/);
});

test("end to end: turn_end drafts apply through pi's SessionManager and drop the images", async () => {
	const { SessionManager } = await import("@earendil-works/pi-coding-agent");
	const { stubPi, stubCtx } = await import("./helpers/stub-pi.mjs");
	process.env.BOEHSLINE_CONFIG = join(mkdtempSync(join(tmpdir(), "image-prune-cfg-")), "none.json");
	process.env.BOEHSLINE_ENABLE = "image-prune";
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "image-prune-agent-"));
	try {
		const { default: ext } = await import(`../extensions/opt-in/image-prune/index.ts?e2e=${Math.random()}`);
		const s = stubPi();
		await ext(s.pi);
		assert.deepEqual(s.names(), ["command:image-prune", "on:turn_end"]);

		const sm = SessionManager.inMemory("/tmp");
		const ts = Date.now();
		const big = Buffer.alloc(3 * MB, 1).toString("base64");
		sm.appendMessage({ role: "user", content: [text("paste"), { type: "image", data: big, mimeType: "image/png" }], timestamp: ts });
		sm.appendMessage({ role: "assistant", content: [text("seen")], api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: ts });
		sm.appendMessage({ role: "user", content: [text("more"), { type: "image", data: big, mimeType: "image/png" }], timestamp: ts });
		sm.appendMessage({ role: "user", content: [text("latest")], timestamp: ts });

		const { ctx, notes } = stubCtx();
		const [result] = await s.fire("turn_end", { entries: [], context: { contextEntries: sm.buildSessionProjection().entries } }, ctx);
		assert.equal(result.entries.length, 1, "only the image older than the last 2 user turns");
		for (const draft of result.entries) sm.appendContextEdit(draft.targetId, draft.replacement);
		const projected = sm.buildSessionProjection();
		const sent = JSON.stringify(projected.messages);
		assert.equal(sent.split(big).length - 1, 1, "one image left");
		assert.match(sent, /image removed to save context: .*tmp\/image-prune\/[0-9a-f]{16}\.png, image\/png, ~3072 KB/);
		assert.match(notes[0][1], /removed 1 image \(4\.0 MB\)/);

		// Under the threshold now: the next turn_end leaves the context alone.
		const [again] = await s.fire("turn_end", { entries: [], context: { contextEntries: projected.entries } }, ctx);
		assert.equal(again, undefined);
	} finally {
		delete process.env.BOEHSLINE_ENABLE;
		delete process.env.PI_CODING_AGENT_DIR;
	}
});
