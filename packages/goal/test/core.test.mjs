import assert from "node:assert/strict";
import { test } from "node:test";
import {
  budgetGone,
  budgetLine,
  fmt,
  parseDuration,
  parseGoalArgs,
  parseVerdict,
  phaseOf,
  summarizeStats,
  tail,
  tokenize,
} from "../lib/core.ts";

const NOW = 1_000_000_000;
const budget = (o = {}) => ({ budgetMs: 30 * 60_000, deadline: NOW + 30 * 60_000, toolCalls: 0, ...o });

test("fmt", () => {
  assert.equal(fmt(-5000), "0s");
  assert.equal(fmt(14_000), "14s");
  assert.equal(fmt(150_000), "2m 30s");
  assert.equal(fmt(180_000), "3m");
  assert.equal(fmt(11 * 60_000 + 20_000), "11m");
  assert.equal(fmt(90 * 60_000), "1h 30m");
});

test("parseDuration", () => {
  assert.equal(parseDuration("30"), 30 * 60_000);
  assert.equal(parseDuration("90s"), 90_000);
  assert.equal(parseDuration("1.5h"), 90 * 60_000);
  assert.equal(parseDuration("soon"), undefined);
});

test("tokenize honors quotes", () => {
  assert.deepEqual(tokenize(`--check "bin/rails test a b" fix it`), ["--check", "bin/rails test a b", "fix", "it"]);
  assert.deepEqual(tokenize(`--check 'npm test' x`), ["--check", "npm test", "x"]);
});

test("parseGoalArgs", () => {
  assert.deepEqual(parseGoalArgs(tokenize(`--for 20m --steps 40 --check "./t.sh" make it pass`)), {
    objective: "make it pass",
    budgetMs: 20 * 60_000,
    steps: 40,
    check: "./t.sh",
  });
  assert.equal(parseGoalArgs(["--for", "later", "x"]).error, "Bad duration: later");
  assert.equal(parseGoalArgs(["--steps", "0", "x"]).error, "Bad --steps: 0");
  assert.equal(parseGoalArgs(["--check"]).error, "--check needs a command");
  assert.equal(parseGoalArgs(["just", "do", "it"]).budgetMs, undefined);
});

test("phaseOf follows the tighter of time and steps", () => {
  assert.equal(phaseOf(budget(), NOW), "explore");
  assert.equal(phaseOf(budget(), NOW + 20 * 60_000), "converge");
  assert.equal(phaseOf(budget(), NOW + 27 * 60_000), "wrap");
  assert.equal(phaseOf(budget(), NOW + 31 * 60_000), "over");
  // plenty of time, but 37 of 40 calls used → wrap
  assert.equal(phaseOf(budget({ steps: 40, toolCalls: 37 }), NOW), "wrap");
});

test("budgetGone on time or steps", () => {
  assert.equal(budgetGone(budget(), NOW), false);
  assert.equal(budgetGone(budget(), NOW + 30 * 60_000), true);
  assert.equal(budgetGone(budget({ steps: 10, toolCalls: 10 }), NOW), true);
});

test("budgetLine", () => {
  assert.equal(budgetLine(budget(), NOW + 16 * 60_000), "⏱ goal: 14m left of 30m");
  assert.equal(
    budgetLine(budget({ check: "./t", checkMs: 42_000, steps: 40, toolCalls: 18 }), NOW + 16 * 60_000),
    "⏱ goal: 14m left of 30m · check takes ~42s → ~20 runs left · 22/40 calls left",
  );
  assert.match(budgetLine(budget({ check: "./t", checkMs: 60_000 }), NOW + 29 * 60_000), /~1 run left$/);
});

test("tail", () => {
  const out = tail(Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n"), 3);
  assert.equal(out, "… (47 lines omitted)\nl47\nl48\nl49");
});

test("parseVerdict", () => {
  assert.deepEqual(parseVerdict('```json\n{"done": false, "reason": "README missing"}\n```'), { done: false, reason: "README missing" });
  assert.deepEqual(parseVerdict('Sure! {"done": true}'), { done: true, reason: "" });
  assert.equal(parseVerdict("no json here"), undefined);
  assert.equal(parseVerdict('{"done": "yes"}'), undefined);
  assert.equal(parseVerdict("{not json}"), undefined);
});

test("summarizeStats", () => {
  assert.equal(summarizeStats([]), "No goal stats yet.");
  const s = summarizeStats([
    { model: "a/x", outcome: "met", elapsedMs: 20_000, iterations: 1 },
    { model: "a/x", outcome: "met", elapsedMs: 60_000, iterations: 3 },
    { model: "a/x", outcome: "missed", elapsedMs: 99_000, iterations: 5 },
    { model: "b/y", outcome: "aborted", elapsedMs: 5_000, iterations: 0 },
  ]);
  assert.equal(s, "Goal stats (4 goals):\na/x: 2/3 met (67%) · p50 1m, 3 iter\nb/y: 0/1 met (0%)");
});
