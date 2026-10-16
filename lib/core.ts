/** Pure budget and formatting logic for /goal. No pi imports, so tests run under plain Node. */

export type Phase = "explore" | "converge" | "wrap" | "over";

/** The slice of goal state the budget math needs. */
export interface Budget {
  budgetMs: number;
  deadline: number;
  steps?: number;
  toolCalls: number;
  check?: string;
  checkMs?: number;
}

export const fmt = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 5) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** "30" (minutes), "90s", "30m", "1.5h". */
export const parseDuration = (v: string): number | undefined => {
  const m = v.match(/^(\d+(?:\.\d+)?)(s|m|h)?$/);
  if (!m) return undefined;
  const unit = (m[2] ?? "m") as "s" | "m" | "h";
  return parseFloat(m[1]!) * { s: 1000, m: 60_000, h: 3_600_000 }[unit];
};

/** Split command args, honoring "double" and 'single' quotes. */
export const tokenize = (s: string): string[] =>
  [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");

export interface ParsedArgs {
  objective: string;
  budgetMs?: number;
  steps?: number;
  check?: string;
  error?: string;
}

/** Parse `[--for 30m] [--steps N] [--check "cmd"] <objective>`. */
export const parseGoalArgs = (tokens: string[]): ParsedArgs => {
  const out: ParsedArgs = { objective: "" };
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "--for") {
      const v = tokens[++i] ?? "";
      const d = parseDuration(v);
      if (!d) return { ...out, error: `Bad duration: ${v}` };
      out.budgetMs = d;
    } else if (t === "--steps") {
      const v = tokens[++i] ?? "";
      const n = parseInt(v, 10);
      if (!(n > 0)) return { ...out, error: `Bad --steps: ${v}` };
      out.steps = n;
    } else if (t === "--check") {
      out.check = tokens[++i];
      if (!out.check) return { ...out, error: "--check needs a command" };
    } else rest.push(t);
  }
  out.objective = rest.join(" ").trim();
  return out;
};

export const tail = (s: string, n = 40): string => {
  const lines = s.trimEnd().split("\n");
  return (lines.length > n ? [`… (${lines.length - n} lines omitted)`, ...lines.slice(-n)] : lines).join("\n");
};

export const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}\n… (truncated)` : s);

export const timeLeft = (b: Budget, now = Date.now()) => b.deadline - now;
export const stepsLeft = (b: Budget) => (b.steps ? b.steps - b.toolCalls : Infinity);
export const budgetGone = (b: Budget, now = Date.now()) => timeLeft(b, now) <= 0 || stepsLeft(b) <= 0;

/** The tighter of time and steps decides the phase. */
export const phaseOf = (b: Budget, now = Date.now()): Phase => {
  const frac = Math.min(timeLeft(b, now) / b.budgetMs, b.steps ? stepsLeft(b) / b.steps : 1);
  if (frac <= 0) return "over";
  if (frac <= 0.15) return "wrap";
  if (frac <= 0.4) return "converge";
  return "explore";
};

export const PHASE_GUIDANCE: Record<Phase, string> = {
  explore: "Explore freely: understand the problem, try approaches.",
  converge: "Converge: commit to your best approach. No new directions or big refactors.",
  wrap: "Wrap up: stabilize what works, keep the tree working, prepare a handoff.",
  over: "BUDGET IS USED UP: start nothing new. Finish the current edit, leave things working, write the handoff.",
};

/** "⏱ goal: 14m left of 30m · check takes ~42s → ~20 runs left · 22/40 calls left" */
export const budgetLine = (b: Budget, now = Date.now()): string => {
  const left = timeLeft(b, now);
  const parts = [`⏱ goal: ${fmt(left)} left of ${fmt(b.budgetMs)}`];
  if (b.check && b.checkMs && left > 0) {
    const runs = Math.floor(left / Math.max(b.checkMs, 1000));
    parts.push(`check takes ~${fmt(b.checkMs)} → ~${runs} run${runs === 1 ? "" : "s"} left`);
  }
  if (b.steps) parts.push(`${Math.max(0, stepsLeft(b))}/${b.steps} calls left`);
  return parts.join(" · ");
};

/** Pull {done, reason} out of a judge reply that may wrap the JSON in prose or a fence. */
export const parseVerdict = (text: string): { done: boolean; reason: string } | undefined => {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return undefined;
  try {
    const v = JSON.parse(json);
    return typeof v?.done === "boolean" ? { done: v.done, reason: String(v.reason ?? "") } : undefined;
  } catch {
    return undefined;
  }
};

export interface StatsRecord {
  model?: string;
  outcome: string;
  elapsedMs: number;
  iterations: number;
}

/** Per-model met rate and p50 time/iterations of met goals. */
export const summarizeStats = (rows: StatsRecord[]): string => {
  if (!rows.length) return "No goal stats yet.";
  const by = new Map<string, StatsRecord[]>();
  for (const r of rows) by.set(r.model ?? "?", [...(by.get(r.model ?? "?") ?? []), r]);
  const p50 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : undefined);
  const lines = [...by].map(([model, rs]) => {
    const met = rs.filter((r) => r.outcome === "met");
    const t = p50(met.map((r) => r.elapsedMs));
    const it = p50(met.map((r) => r.iterations));
    const pct = Math.round((100 * met.length) / rs.length);
    return `${model}: ${met.length}/${rs.length} met (${pct}%)` + (t !== undefined ? ` · p50 ${fmt(t)}, ${it} iter` : "");
  });
  return `Goal stats (${rows.length} goals):\n${lines.join("\n")}`;
};
