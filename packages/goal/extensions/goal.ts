/**
 * /goal — work toward a goal until it's met or the budget runs out.
 *
 *   /goal --for 30m --check "bin/rails test test/models/user_test.rb" make the user model tests pass
 *   /goal --for 20m --steps 40 research how X works and write NOTES.md
 *   /goal status | stop | stats
 *
 * The agent can time-box its own subtasks with the start_goal tool.
 *
 * Done means:
 * - with --check: the harness runs the command and it exits 0 (never the agent's own claim).
 *   A baseline run at start confirms it fails and times one run (not charged to the budget).
 * - without: a judge call (the session's current model) reads the objective, the agent's last
 *   message and the git diff, and returns {done, reason}. The reason feeds the re-prompt.
 *
 * Budget: wall-clock (default 30m), plus optional --steps (top-level tool calls). Every top-level
 * tool result gets "[⏱ goal: 14m left of 30m · ~5 check runs left · 22/40 calls left]" appended,
 * plus phase guidance (explore → converge → wrap) when the phase changes.
 *
 * When the agent stops: met → end. Budget left → re-prompt. Budget gone → one handoff turn, then
 * stop. Escape aborts. Hard stop (abort) at deadline + 3m or steps + 10.
 *
 * Live canvas sections (goal, goal-timeline) via the canvas extension's "canvas:put" event.
 * Every finished goal is appended to ~/.pi/agent/goal-stats.jsonl; /goal stats summarizes it.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  budgetGone,
  budgetLine,
  clip,
  fmt,
  PHASE_GUIDANCE,
  type Phase,
  parseGoalArgs,
  parseVerdict,
  phaseOf,
  type StatsRecord,
  stepsLeft,
  summarizeStats,
  tail,
  timeLeft,
  tokenize,
} from "../lib/core.ts";
import { activateToolSearch } from "../../../lib/tool-search.ts";

const DEFAULT_BUDGET_MS = 30 * 60_000;
const GRACE_MS = 3 * 60_000;
const GRACE_STEPS = 10;
const MAX_ITERATIONS = 40;
const OUTPUT_TAIL_LINES = 40;
const CANVAS_THROTTLE_MS = 20_000;
const JUDGE_TIMEOUT_MS = 90_000;
const STATS_PATH = join(homedir(), ".pi", "agent", "goal-stats.jsonl");

type Outcome = "met" | "missed" | "aborted" | "stopped" | "hard-stop" | "max-iterations";
type Tone = "ok" | "warn" | "bad" | "accent" | "dim";

interface TimelineEvent {
  at: string;
  title: string;
  note?: string;
  tone?: Tone;
}

interface GoalState {
  objective: string;
  check?: string;
  steps?: number;
  source: "command" | "tool";
  startedAt: number;
  deadline: number;
  budgetMs: number;
  checkMs?: number;
  toolCalls: number;
  iterations: number;
  phase: Phase;
  handoffSent: boolean;
  judgeCost: number;
  verdicts: string[];
  startSha?: string;
  events: TimelineEvent[];
  canvasAt: number;
  timer?: ReturnType<typeof setInterval>;
}

interface StartOptions {
  objective: string;
  budgetMs: number;
  check?: string;
  steps?: number;
  source: "command" | "tool";
}

let goal: GoalState | undefined;

const textOf = (content: unknown): string =>
  Array.isArray(content) ? content.map((c: any) => (c?.type === "text" ? c.text : "")).join("") : String(content ?? "");

// ── extension ──

export default function (pi: ExtensionAPI) {
  let lastCtx: ExtensionContext | undefined;

  const setStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const g = goal;
    ctx.ui.setStatus(
      "goal",
      g ? `🎯 ${fmt(timeLeft(g))}${g.steps ? ` · ${Math.max(0, stepsLeft(g))} calls` : ""} · ${phaseOf(g)}` : undefined,
    );
  };

  const canvasPut = (ctx: ExtensionContext, params: Record<string, unknown>) => {
    try {
      pi.events?.emit?.("canvas:put", { params, ctx, reply: () => {} });
    } catch {
      // canvas extension absent or failed; the goal doesn't depend on it
    }
  };

  const renderCanvas = (ctx: ExtensionContext, final?: { outcome: Outcome; msg: string }) => {
    const g = goal;
    if (!g) return;
    g.canvasAt = Date.now();
    const elapsed = Date.now() - g.startedAt;
    const stats: Record<string, unknown>[] = [
      final
        ? { label: "Outcome", value: final.outcome, note: final.msg }
        : { label: "Time left", value: fmt(timeLeft(g)), note: `of ${fmt(g.budgetMs)} · ${phaseOf(g)}` },
      { label: "Elapsed", value: fmt(elapsed) },
      g.steps
        ? { label: "Calls left", value: Math.max(0, stepsLeft(g)), note: `of ${g.steps}` }
        : { label: "Tool calls", value: g.toolCalls },
      { label: "Iterations", value: g.iterations, note: g.check ? "check" : "judge" },
    ];
    canvasPut(ctx, { kind: "stats", id: "goal", title: `🎯 ${clip(g.objective, 90)}`, body: JSON.stringify(stats) });
    canvasPut(ctx, { kind: "timeline", id: "goal-timeline", title: "Goal timeline", body: JSON.stringify({ events: g.events, order: "given" }) });
  };

  const log = (ctx: ExtensionContext, title: string, note?: string, tone?: Tone) => {
    goal?.events.push({ at: new Date().toISOString(), title, ...(note ? { note: clip(note, 300) } : {}), ...(tone ? { tone } : {}) });
    renderCanvas(ctx);
  };

  const runCheck = async (ctx: ExtensionContext, g: GoalState) => {
    const t0 = Date.now();
    const timeout = Math.max(60_000, Math.min(10 * 60_000, timeLeft(g) + GRACE_MS));
    const r = await pi.exec("bash", ["-lc", g.check!], { cwd: ctx.cwd, timeout });
    g.checkMs = Date.now() - t0;
    return { ...r, output: tail(`${r.stdout}\n${r.stderr}`, OUTPUT_TAIL_LINES) };
  };

  const judge = async (ctx: ExtensionContext, g: GoalState, lastMessage: string): Promise<{ done: boolean; reason: string }> => {
    const model = ctx.model;
    if (!model) return { done: false, reason: "no model available to judge" };
    const git = async (args: string[]) => {
      const r = await pi.exec("git", args, { cwd: ctx.cwd, timeout: 15_000 });
      return r.code === 0 ? r.stdout : "";
    };
    // Diff against where the goal started (covers commits made during the goal) plus untracked files,
    // which git diff leaves out.
    const base = g.startSha ?? "HEAD";
    const [status, diff, untracked] = await Promise.all([
      git(["status", "--short"]),
      git(["diff", base]),
      git(["ls-files", "--others", "--exclude-standard"]),
    ]);
    let newFiles = "";
    for (const f of untracked.split("\n").filter(Boolean).slice(0, 20)) {
      try {
        newFiles += `--- new file: ${f}\n${clip(readFileSync(join(ctx.cwd, f), "utf8"), 3000)}\n`;
      } catch {}
      if (newFiles.length > 12000) break;
    }
    const system =
      "You judge whether a coding agent has fully met its goal. Be strict: partial progress, plans, " +
      "or claims without evidence are not done. Reply with only JSON: " +
      '{"done": true|false, "reason": "<one or two sentences; if not done, the most important thing missing>"}';
    const user =
      `GOAL:\n${g.objective}\n\n` +
      `AGENT'S FINAL MESSAGE:\n${clip(lastMessage, 6000) || "(empty)"}\n\n` +
      `GIT STATUS:\n${clip(status, 2000) || "(clean or not a repo)"}\n\n` +
      `GIT DIFF since the goal started:\n${clip(diff, 12000) || "(none)"}\n\n` +
      `NEW UNTRACKED FILES:\n${clip(newFiles, 12000) || "(none)"}`;
    try {
      const stream = ctx.modelRegistry.streamSimple(
        model,
        { systemPrompt: system, messages: [{ role: "user", content: user, timestamp: Date.now() }] },
        { maxTokens: 1500, signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS) },
      );
      const r: any = await stream.result();
      g.judgeCost += r.usage?.cost?.total ?? 0;
      if (r.stopReason === "error" || r.stopReason === "aborted") return { done: false, reason: `judge failed: ${r.errorMessage ?? r.stopReason}` };
      const text = textOf(r.content);
      const v = parseVerdict(text);
      return v ?? { done: false, reason: `judge reply unparseable: ${clip(text, 200)}` };
    } catch (e) {
      return { done: false, reason: `judge error: ${(e as Error).message}` };
    }
  };

  const end = (ctx: ExtensionContext, outcome: Outcome, msg: string) => {
    const g = goal;
    if (!g) return;
    if (g.timer) clearInterval(g.timer);
    const tone: Tone = outcome === "met" ? "ok" : outcome === "missed" ? "warn" : "bad";
    g.events.push({ at: new Date().toISOString(), title: `Ended: ${outcome}`, note: msg, tone });
    renderCanvas(ctx, { outcome, msg });
    const record = {
      ts: new Date().toISOString(),
      objective: g.objective,
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
      thinking: ctx.thinkingLevel,
      mode: g.check ? "check" : "judge",
      source: g.source,
      budgetMs: g.budgetMs,
      steps: g.steps,
      elapsedMs: Date.now() - g.startedAt,
      toolCalls: g.toolCalls,
      iterations: g.iterations,
      judgeCostUsd: g.judgeCost || undefined,
      verdicts: g.verdicts.length ? g.verdicts : undefined,
      outcome,
      cwd: ctx.cwd,
    };
    try {
      appendFileSync(STATS_PATH, `${JSON.stringify(record)}\n`);
    } catch {}
    pi.appendEntry("goal-end", record);
    goal = undefined;
    setStatus(ctx);
    if (ctx.hasUI) ctx.ui.notify(msg, outcome === "met" ? "info" : "warning");
  };

  /** Shared by /goal and start_goal. Returns the instructions for the agent, or an error / early-exit message. */
  const start = async (ctx: ExtensionContext, o: StartOptions): Promise<{ ok: boolean; text: string }> => {
    if (goal) return { ok: false, text: `A goal is already active: ${goal.objective}` };
    const now = Date.now();
    const g: GoalState = {
      objective: o.objective,
      check: o.check,
      steps: o.steps,
      source: o.source,
      startedAt: now,
      deadline: now + o.budgetMs,
      budgetMs: o.budgetMs,
      toolCalls: 0,
      iterations: 0,
      phase: "explore",
      handoffSent: false,
      judgeCost: 0,
      verdicts: [],
      events: [],
      canvasAt: 0,
    };

    if (!o.check) {
      const r = await pi.exec("git", ["rev-parse", "HEAD"], { cwd: ctx.cwd, timeout: 10_000 });
      if (r.code === 0) g.startSha = r.stdout.trim();
    }

    let baseline = "";
    if (o.check) {
      if (ctx.hasUI) ctx.ui.notify(`Running baseline check: ${o.check}`, "info");
      const r = await runCheck(ctx, g);
      if (r.code === 0) return { ok: false, text: `The check already passes (${o.check}); nothing to do.` };
      g.startedAt = Date.now();
      g.deadline = g.startedAt + o.budgetMs;
      baseline = `\n\nBaseline check (exit ${r.code}, took ${fmt(g.checkMs!)}):\n\`\`\`\n${r.output}\n\`\`\``;
    }

    goal = g;
    lastCtx = ctx;
    g.timer = setInterval(() => lastCtx && setStatus(lastCtx), 15_000);
    setStatus(ctx);
    pi.appendEntry("goal-start", { objective: o.objective, check: o.check, steps: o.steps, budgetMs: o.budgetMs, source: o.source });
    log(ctx, "Goal started", `${fmt(o.budgetMs)}${o.steps ? `, ${o.steps} calls` : ""} · ${o.check ? `check: ${o.check}` : "judge"}`, "accent");

    const doneRule = o.check
      ? `The goal is met when this command exits 0 (the harness runs it when you stop, not you): \`${o.check}\`\nDo not weaken, skip, or edit the check or its tests to make it pass.`
      : `When you stop, a judge reviews your final message and the git diff against the goal. Stop only when it's fully met, and end with a short summary of what you did and how you verified it.`;
    const budget = `${fmt(o.budgetMs)}${o.steps ? ` / ${o.steps} tool calls` : ""}`;
    return {
      ok: true,
      text:
        `🎯 Goal (budget ${budget}): ${o.objective}\n\n${doneRule}\n\n` +
        `The remaining budget is appended to tool results. Plan with it: explore early, converge later, stabilize near the end. ` +
        `If you stop before the goal is met you'll be sent back with what's missing. If the budget runs out you get one final turn ` +
        `to leave things working and write a short handoff (done, left, next step).` +
        baseline,
    };
  };

  // ── /goal ──

  const statsSummary = () => {
    try {
      const rows = readFileSync(STATS_PATH, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as StatsRecord);
      return summarizeStats(rows);
    } catch {
      return "No goal stats yet.";
    }
  };

  pi.registerCommand("goal", {
    description: 'Work until a goal is met or the budget runs out: /goal [--for 30m] [--steps N] [--check "cmd"] <objective> | status | stop | stats',
    handler: async (args, ctx) => {
      const tokens = tokenize(args ?? "");
      const sub = tokens[0];
      if (sub === "stop") return goal ? end(ctx, "stopped", "Goal stopped.") : ctx.ui.notify("No active goal.", "info");
      if (sub === "stats") return ctx.ui.notify(statsSummary(), "info");
      if (sub === "status" || tokens.length === 0) {
        return ctx.ui.notify(
          goal ? `🎯 ${goal.objective}\n${budgetLine(goal)} · phase ${phaseOf(goal)} · iteration ${goal.iterations}` : "No active goal.",
          "info",
        );
      }
      if (!ctx.isIdle()) return ctx.ui.notify("Wait for the agent to finish (or Esc) before starting a goal.", "warning");

      const parsed = parseGoalArgs(tokens);
      if (parsed.error) return ctx.ui.notify(parsed.error, "error");
      const { objective, check, steps } = parsed;
      const budgetMs = parsed.budgetMs ?? DEFAULT_BUDGET_MS;
      if (!objective) return ctx.ui.notify("Give an objective.", "error");

      const r = await start(ctx, { objective, budgetMs, check, steps, source: "command" });
      if (!r.ok) return ctx.ui.notify(r.text, "warning");
      pi.sendUserMessage(r.text);
    },
  });

  // ── start_goal tool ──

  // start_goal is deferred, so tool_search must be active to reach it.
  activateToolSearch(pi);

  pi.registerTool({
    name: "start_goal",
    label: "Start goal",
    // Deferred: not declared to the model until tool_search finds it, so it costs
    // no context in the many sessions that never time-box work. /goal is unaffected.
    exposure: "deferred",
    description:
      "Time-box a piece of work. Starts a goal with a budget: the harness keeps you going until it's met (a check command exits 0, " +
      "or a judge agrees from your final message and the git diff) or the budget runs out, then asks for a handoff. " +
      "Remaining time and calls are appended to every tool result. One goal at a time. Use it for open-ended work that " +
      "could sprawl: debugging, research, getting a test suite green.",
    parameters: Type.Object({
      objective: Type.String({ description: "What done looks like, concretely" }),
      minutes: Type.Optional(Type.Number({ description: "Wall-clock budget in minutes (default 30)" })),
      check: Type.Optional(Type.String({ description: "Shell command that exits 0 when the goal is met, e.g. a test command" })),
      steps: Type.Optional(Type.Number({ description: "Optional cap on tool calls" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const budgetMs = params.minutes && params.minutes > 0 ? params.minutes * 60_000 : DEFAULT_BUDGET_MS;
      const steps = params.steps && params.steps > 0 ? Math.floor(params.steps) : undefined;
      const r = await start(ctx, { objective: params.objective, budgetMs, check: params.check, steps, source: "tool" });
      if (!r.ok) throw new Error(r.text);
      return { content: [{ type: "text", text: r.text }], details: undefined };
    },
  });

  // ── budget injection ──

  pi.on("tool_result", async (event, ctx) => {
    const g = goal;
    if (!g || event.parentToolCallId || event.toolName === "start_goal") return;
    lastCtx = ctx;
    g.toolCalls++;
    setStatus(ctx);

    if (timeLeft(g) < -GRACE_MS || stepsLeft(g) < -GRACE_STEPS) {
      end(ctx, "hard-stop", "Goal hard-stopped: the agent kept going well past its budget.");
      ctx.abort();
      return;
    }

    const phase = phaseOf(g);
    let text = budgetLine(g);
    if (phase !== g.phase) {
      g.phase = phase;
      text += `\n${PHASE_GUIDANCE[phase]}`;
      log(ctx, `Phase: ${phase}`, budgetLine(g), phase === "over" ? "bad" : phase === "wrap" ? "warn" : "dim");
    } else if (phase === "over") text += `\n${PHASE_GUIDANCE.over}`;
    if (Date.now() - g.canvasAt > CANVAS_THROTTLE_MS) renderCanvas(ctx);

    return {
      content: [...event.content, { type: "text", text: `\n\n[${text}]` }],
      structuredContent: event.structuredContent,
    };
  });

  // ── keep going / stop ──

  pi.on("agent_before_settle", async (event, ctx) => {
    const g = goal;
    if (!g) return;
    lastCtx = ctx;
    if (event.outcome === "aborted") return end(ctx, "aborted", "Goal aborted.");
    if (event.outcome === "error") return; // pi retries; goal stays active

    g.iterations++;
    const elapsed = () => fmt(Date.now() - g.startedAt);

    let missing: string;
    if (g.check) {
      const r = await runCheck(ctx, g);
      if (r.code === 0) return end(ctx, "met", `🎯 Goal met in ${elapsed()} (${g.iterations} iteration${g.iterations === 1 ? "" : "s"}, ${g.toolCalls} calls).`);
      missing = `Check still failing (exit ${r.code}${r.killed ? ", timed out" : ""}):\n\`\`\`\n${r.output}\n\`\`\``;
      log(ctx, `Iteration ${g.iterations}: check failed`, `exit ${r.code}`, "warn");
    } else {
      const last = [...event.context.llmMessages].reverse().find((m: any) => m.role === "assistant");
      if (ctx.hasUI) ctx.ui.setStatus("goal", "🎯 judging…");
      const v = await judge(ctx, g, textOf(last?.content));
      setStatus(ctx);
      g.verdicts.push(`${v.done ? "done" : "not done"}: ${v.reason}`);
      if (v.done) return end(ctx, "met", `🎯 Goal met in ${elapsed()} (judge: ${v.reason})`);
      missing = `Judge: not done yet. ${v.reason}`;
      log(ctx, `Iteration ${g.iterations}: judge says not done`, v.reason, "warn");
    }

    if (g.handoffSent) return end(ctx, "missed", `Goal missed: budget used (${elapsed()}, ${g.toolCalls} calls). Handoff written.`);
    if (g.iterations >= MAX_ITERATIONS) return end(ctx, "max-iterations", `Goal stopped after ${MAX_ITERATIONS} iterations.`);

    let content: string;
    if (budgetGone(g)) {
      g.handoffSent = true;
      log(ctx, "Budget used up: handoff turn", undefined, "bad");
      content =
        `⏱ Budget used up for goal: ${g.objective}\n${missing}\n\n` +
        `Final turn: start nothing new. Leave the tree working, then write a brief handoff: what's done, what's left, the most likely next step.`;
    } else {
      content = `${missing}\n\n[${budgetLine(g)} · ${PHASE_GUIDANCE[phaseOf(g)]}]\nContinue toward the goal: ${g.objective}`;
    }
    setStatus(ctx);
    return { entries: [{ type: "custom_message", customType: "goal", content, display: true }], continue: true };
  });

  pi.on("session_shutdown", async () => {
    if (goal?.timer) clearInterval(goal.timer);
    goal = undefined;
  });
}
