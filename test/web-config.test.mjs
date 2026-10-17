// web.json: a file that doesn't parse is never overwritten, and markSkip (fired
// unawaited from fetch tiers, awaited inside the search chain's catch) never
// rejects, even when the config can't be written.

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const agentDir = mkdtempSync(join(tmpdir(), "web-config-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const broken = '{ "search": { "order": ["exa", "brave"], }, "fetch": { "off": ["safari"] } ';
writeFileSync(join(agentDir, "web.json"), broken);

const { activeChain, configProblem, loadConfig, markSkip, mutateConfig } = await import("../extensions/web/providers/config.ts");

test("a web.json that doesn't parse stays as it is: defaults in memory, saves refused, cool-offs still held", async () => {
  const cfg = await loadConfig();
  assert.match(configProblem() ?? "", /web\.json doesn't parse/);
  assert.ok(cfg.search.order.length > 0, "defaults stand in");
  await assert.rejects(mutateConfig((c) => (c.format = "serp")), /not overwritten/);
  // markSkip doesn't reject, and the cool-off holds for this process.
  await markSkip("exa", 60_000);
  assert.equal(activeChain(["exa", "brave"], [], (await loadConfig()).skipUntil).includes("exa"), false);
  assert.equal(readFileSync(join(agentDir, "web.json"), "utf8"), broken, "the user's file is untouched");
});

test("markSkip never rejects when web.json can't be written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-config-ro-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  const fresh = await import(`../extensions/web/providers/config.ts?ro=${Date.now()}`);
  await fresh.loadConfig();
  chmodSync(dir, 0o500);
  try {
    await assert.doesNotReject(fresh.markSkip("brave", 60_000));
    assert.ok((await fresh.loadConfig()).skipUntil.brave > Date.now(), "held in memory");
  } finally {
    chmodSync(dir, 0o700);
  }
});
