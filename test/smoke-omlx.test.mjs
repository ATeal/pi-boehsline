import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stubPi } from "./helpers/stub-pi.mjs";

const dir = mkdtempSync(join(tmpdir(), "omlx-"));
process.env.BOEHSLINE_CONFIG = join(dir, "none.json");
process.env.BOEHSLINE_ENABLE = "omlx";
process.env.OMLX_MODEL_DIR = join(dir, "models");
// A local model folder whose config.json says it has vision and a 64k context.
mkdirSync(join(dir, "models", "Gemma-Vision"), { recursive: true });
writeFileSync(join(dir, "models", "Gemma-Vision", "config.json"), JSON.stringify({ vision_config: {}, max_position_embeddings: 65536, model_type: "gemma3" }));

const { default: omlx } = await import("../extensions/opt-in/omlx.ts");
const realFetch = globalThis.fetch;
const serve = (body) => { globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 }); };

test("omlx: server down registers nothing", async () => {
	globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
	try {
		const s = stubPi();
		await omlx(s.pi);
		assert.deepEqual(s.names(), []);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("omlx: registers chat models only, with reasoning and vision worked out", async () => {
	serve({ data: [
		{ id: "Qwen3-30B-A3B-4bit", max_model_len: 131072 },
		{ id: "Gemma-Vision", max_model_len: 200000 },
		{ id: "MarkItDown", max_model_len: null },
	] });
	try {
		const s = stubPi();
		await omlx(s.pi);
		assert.deepEqual(s.names(), ["provider:omlx"]);
		const { models, api } = s.providers.get("omlx");
		assert.equal(api, "openai-completions");
		assert.deepEqual(models.map((m) => m.id), ["Qwen3-30B-A3B-4bit", "Gemma-Vision"], "MarkItDown has no context length");
		const [qwen, gemma] = models;
		assert.equal(qwen.reasoning, true);
		assert.equal(qwen.compat.thinkingFormat, "chat-template");
		assert.deepEqual(qwen.input, ["text"]);
		assert.deepEqual(gemma.input, ["text", "image"]);
		assert.equal(gemma.contextWindow, 65536, "the smaller of served and config");
		assert.equal(gemma.compat, undefined, "not a reasoning model");
	} finally {
		globalThis.fetch = realFetch;
	}
});
