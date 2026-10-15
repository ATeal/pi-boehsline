import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	readGuardianConfigObject,
	updateGuardianConfigFile,
} from "../src/config-file.ts";
import { loadGuardianConfig } from "../src/config.ts";
import { DEFAULT_REVIEWER_MODEL } from "../src/review.ts";
import {
	applySettingChange,
	buildSettingItems,
	defaultLabel,
	matchesAllTerms,
} from "../src/settings-menu.ts";

function tempAgentDir(contents?: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "guardian-settings-"));
	if (contents !== undefined) {
		writeFileSync(join(dir, "approval-guardian.json"), JSON.stringify(contents));
	}
	return dir;
}

function itemsFor(raw: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) {
	const agentDir = tempAgentDir(raw);
	const config = loadGuardianConfig({
		cwd: agentDir,
		projectTrusted: false,
		agentDir,
		env,
	});
	return buildSettingItems({
		raw,
		config,
		modelSpecs: ["anthropic/claude", "openai/gpt"],
		bypassed: false,
		modelSubmenu: () => undefined,
		actionSubmenu: () => undefined,
	});
}

test("settings rows reflect global values and defaults", () => {
	const items = itemsFor({
		model: "openai/gpt",
		timeoutMs: 45_000,
		review: { "read.path": "always" },
	});
	const byId = new Map(items.map((item) => [item.id, item]));
	assert.equal(byId.get("bypass")?.currentValue, "enabled");
	assert.equal(byId.get("model")?.currentValue, "openai/gpt");
	assert.equal(
		byId.get("fallbackModel")?.currentValue,
		defaultLabel(DEFAULT_REVIEWER_MODEL),
	);
	assert.equal(byId.get("timeoutMs")?.currentValue, "45s");
	assert.ok(byId.get("timeoutMs")?.values?.includes("45s"));
	assert.equal(byId.get("policy")?.currentValue, "none");
	assert.equal(byId.get("review:read.path")?.currentValue, "always");
	assert.equal(
		byId.get("review:bash.command")?.currentValue,
		defaultLabel("always"),
	);
});

test("settings rows note environment overrides", () => {
	const items = itemsFor(
		{ model: "openai/gpt" },
		{ PI_APPROVAL_GUARDIAN_MODEL: "anthropic/claude" },
	);
	const model = items.find((item) => item.id === "model");
	assert.equal(model?.currentValue, "openai/gpt");
	assert.match(model?.description ?? "", /anthropic\/claude comes from the environment/);
});

test("applies setting changes and clears defaults", () => {
	const raw: Record<string, unknown> = { policy: "keep", extra: 1 };
	applySettingChange(raw, "model", "openai/gpt");
	applySettingChange(raw, "timeoutMs", "120s");
	applySettingChange(raw, "review:read.path", "off");
	assert.deepEqual(raw, {
		policy: "keep",
		extra: 1,
		model: "openai/gpt",
		timeoutMs: 120_000,
		review: { "read.path": "off" },
	});
	applySettingChange(raw, "model", defaultLabel(DEFAULT_REVIEWER_MODEL));
	applySettingChange(raw, "timeoutMs", defaultLabel("90s"));
	applySettingChange(raw, "review:read.path", defaultLabel("private-only"));
	assert.deepEqual(raw, { policy: "keep", extra: 1, review: {} });
	assert.throws(() => applySettingChange(raw, "nope", "x"));
});

test("config file updates preserve unknown keys and drop empty review", () => {
	const dir = tempAgentDir({ policy: "p", review: { "ls.path": "off" } });
	const path = join(dir, "approval-guardian.json");
	updateGuardianConfigFile(path, (raw) =>
		applySettingChange(raw, "review:ls.path", defaultLabel("private-only")),
	);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { policy: "p" });

	const fresh = join(tempAgentDir(), "nested", "approval-guardian.json");
	updateGuardianConfigFile(fresh, (raw) => applySettingChange(raw, "model", "a/b"));
	assert.deepEqual(readGuardianConfigObject(fresh), { model: "a/b" });
});

test("model filter matches every term as a substring", () => {
	assert.equal(matchesAllTerms("amazon-bedrock/claude-opus-4-6", "bedrock opus"), true);
	assert.equal(matchesAllTerms("openrouter/amazon/nova-pro", "opus"), false);
	assert.equal(matchesAllTerms("anything", "  "), true);
});

test("refuses to overwrite a config file that is not a JSON object", () => {
	const dir = tempAgentDir();
	const path = join(dir, "approval-guardian.json");
	writeFileSync(path, "[1, 2]");
	assert.throws(() => updateGuardianConfigFile(path, () => undefined), /not a JSON object/);
	writeFileSync(path, "{ broken");
	assert.throws(() => updateGuardianConfigFile(path, () => undefined));
	assert.equal(readFileSync(path, "utf8"), "{ broken");
});
