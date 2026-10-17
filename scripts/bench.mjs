#!/usr/bin/env node
/**
 * Boot time and starting context: stock pi vs pi with Boehsline.
 *
 *   node scripts/bench.mjs [--runs 9] [--model provider/id] [--json out.json] [--real]
 *   node scripts/bench.mjs --each [--runs 5]    one extension at a time on stock pi
 *   node scripts/bench.mjs --check docs/benchmarks.md [--tolerance 0.1]
 *       CI: measure starting context only, offline, and fail if Boehsline's
 *       total is more than 10% over the number documented there
 *
 * --offline uses a stand-in Anthropic-API model (no login needed: the probe
 * exits before anything is sent), --context-only skips the boot timing, and
 * PI_BIN points at a pi that isn't on PATH.
 *
 * Each config gets its own empty agent dir (auth.json and models.json are
 * symlinked from yours, never copied) and runs from an empty cwd, so no
 * AGENTS.md, skills or packages of yours leak in:
 *
 *   stock      pi with nothing installed
 *   boehsline  pi + this checkout, defaults (opt-ins off)
 *   all-on     pi + this checkout, every opt-in enabled
 *   real       your own agent dir as-is (--real; for your eyes, not the docs)
 *
 * Boot: PI_STARTUP_BENCHMARK=1 PI_TIMING=1 makes pi build the full TUI, print
 * its startup phases (and per-extension load times) and exit. It needs a
 * terminal that answers its queries, so it runs in a detached tmux session.
 * One warm-up run is dropped; medians
 * are reported.
 *
 * Context: a probe extension (loaded last) captures the first provider
 * request at before_provider_request and exits before it is sent, so no
 * tokens are spent. Reported: system prompt and tool schema sizes, tool
 * names, and a token estimate (characters / 3.6, about right for Claude).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};
const RUNS = Number(opt("runs", "9"));
const CHECK = opt("check");
const OFFLINE = args.includes("--offline") || Boolean(CHECK);
const CONTEXT_ONLY = args.includes("--context-only") || Boolean(CHECK);
const PI = process.env.PI_BIN || "pi";
// A stand-in model in the same API format as Claude on Copilot or Anthropic,
// so offline numbers match the documented ones. Never called: the probe exits
// at before_provider_request.
const OFFLINE_PROVIDER = {
	bench: {
		baseUrl: "http://127.0.0.1:9",
		api: "anthropic-messages",
		apiKey: "bench-offline",
		models: [{ id: "claude-bench", name: "Bench (offline)", reasoning: true, contextWindow: 200000, maxTokens: 32000 }],
	},
};
const REAL_AGENT = join(homedir(), ".pi", "agent");
const realSettings = (() => {
	try {
		return JSON.parse(readFileSync(join(REAL_AGENT, "settings.json"), "utf8"));
	} catch {
		return {};
	}
})();
const MODEL = OFFLINE ? "bench/claude-bench" : opt("model", realSettings.defaultProvider ? `${realSettings.defaultProvider}/${realSettings.defaultModel}` : "");
if (!MODEL) throw new Error("pass --model provider/id (a model you're logged in to)");
const OPT_INS = ["approval-guardian", "meeting", "omlx", "sc", "tmux-attention", "update", "watch", "wiki-session-log"];
const CHARS_PER_TOKEN = 3.6;

const work = mkdtempSync(join(tmpdir(), "boehsline-bench-"));
const cwd = join(work, "cwd");
mkdirSync(cwd);

const PROBE = join(work, "probe.ts");
writeFileSync(
	PROBE,
	`import { writeFileSync } from "node:fs";
export default function (pi: any) {
  pi.on("before_provider_request", (event: any) => {
    writeFileSync(process.env.BENCH_OUT!, JSON.stringify(event.payload));
    process.exit(0);
  });
}
`,
);

function agentDir(name, settings, config) {
	const dir = join(work, name);
	mkdirSync(dir);
	if (OFFLINE) writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: OFFLINE_PROVIDER }));
	else for (const f of ["auth.json", "models.json"]) if (existsSync(join(REAL_AGENT, f))) symlinkSync(join(REAL_AGENT, f), join(dir, f));
	const [provider, ...rest] = MODEL.split("/");
	writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultProvider: provider, defaultModel: rest.join("/"), quietStartup: true, ...settings }, null, 2));
	writeFileSync(join(dir, "boehsline.json"), JSON.stringify(config));
	return dir;
}

const configs = [
	{ name: "stock", env: { PI_CODING_AGENT_DIR: agentDir("stock", {}, {}) } },
	{ name: "boehsline", env: { PI_CODING_AGENT_DIR: agentDir("boehsline", { packages: [ROOT] }, {}) } },
	{ name: "all-on", env: { PI_CODING_AGENT_DIR: agentDir("all-on", { packages: [ROOT] }, { enable: OPT_INS }) } },
];
if (args.includes("--real")) configs.push({ name: "real", env: { PI_CODING_AGENT_DIR: REAL_AGENT } });

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/** Parse "--- Startup Timings: <ns> ---" blocks into { ns: { label: ms } }. */
function parseTimings(text) {
	const out = {};
	let ns;
	for (const raw of text.replace(/\r/g, "").split("\n")) {
		const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
		const head = line.match(/--- Startup Timings: (\S+) ---/);
		if (head) {
			ns = head[1];
			out[ns] = {};
			continue;
		}
		const row = ns && line.match(/^\s+(.+): (\d+)ms$/);
		if (row) out[ns][row[1]] = Number(row[2]);
		else if (ns && /^-+$/.test(line.trim())) ns = undefined;
	}
	return out;
}

// pi waits for the terminal to answer its capability queries, so it needs a
// real terminal emulator, not a bare pty: each boot runs in a detached tmux
// session. A Python timer runs pi with stderr (where the timings go) in a file
// and records the wall time.
const TIMER = `
import json, subprocess, sys, time
out, err = sys.argv[1], sys.argv[2]
t0 = time.perf_counter()
e = open(err, "w")
p = subprocess.Popen([sys.argv[3], "--no-session"], stderr=e)
# pi prints its timings once the TUI is up. Extensions that hold timers or
# watchers keep the process alive afterwards (pi doesn't process.exit in
# benchmark mode), so the clock stops at the timings and pi is stopped.
wall = None
while p.poll() is None and time.perf_counter() - t0 < 60:
    text = open(err).read()
    i = text.find("Startup Timings: main")
    if i >= 0 and "TOTAL" in text[i:]:
        wall = (time.perf_counter() - t0) * 1000
        time.sleep(0.2)
        break
    time.sleep(0.005)
if wall is None:
    wall = (time.perf_counter() - t0) * 1000
p.kill()
json.dump({"wall": wall, "exited": p.poll() is not None}, open(out, "w"))
`;
let bootSeq = 0;

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function bootOnce(env) {
	const id = `${process.pid}-${bootSeq++}`;
	const out = join(work, `boot-${id}.json`);
	const err = join(work, `boot-${id}.err`);
	const vars = { ...env, PI_STARTUP_BENCHMARK: "1", PI_TIMING: "1" };
	const session = `boehsline-bench-${id}`;
	execFileSync("tmux", [
		"new-session", "-d", "-s", session, "-x", "160", "-y", "50", "-c", cwd,
		...Object.entries(vars).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
		"python3", "-c", TIMER, out, err, PI,
	]);
	const deadline = Date.now() + 60_000;
	while (!existsSync(out) && Date.now() < deadline) sleep(50);
	spawnSync("tmux", ["kill-session", "-t", session], { stdio: "ignore" });
	if (!existsSync(out)) throw new Error(`pi didn't finish booting in 60s (${err})`);
	const { wall } = JSON.parse(readFileSync(out, "utf8"));
	const text = readFileSync(err, "utf8");
	const timings = parseTimings(text);
	if (!timings.main) throw new Error(`no timings from pi:\n${text.slice(-2000)}`);
	return { wall, timings };
}

function boot(env) {
	bootOnce(env); // warm-up: page cache, jiti cache, first-run setup
	const runs = Array.from({ length: RUNS }, () => bootOnce(env));
	const main = median(runs.map((r) => r.timings.main.TOTAL));
	const wall = median(runs.map((r) => r.wall));
	const ext = {};
	for (const r of runs) for (const [label, ms] of Object.entries(r.timings.extensions ?? {})) (ext[label] ??= []).push(ms);
	const extensions = Object.fromEntries(Object.entries(ext).map(([k, v]) => [k, median(v)]));
	const phases = {};
	for (const r of runs) for (const [label, ms] of Object.entries(r.timings.main)) (phases[label] ??= []).push(ms);
	return { wall, main, phases: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, median(v)])), extensions };
}

function textOf(x) {
	if (typeof x === "string") return x;
	if (Array.isArray(x)) return x.map(textOf).join("\n");
	if (x && typeof x === "object") return textOf(x.text ?? x.content ?? "");
	return "";
}

function context(env) {
	const out = join(work, `payload-${env.PI_CODING_AGENT_DIR.split("/").pop()}.json`);
	const r = spawnSync(PI, ["--no-session", "-p", "hi", "--model", MODEL, "-e", PROBE], {
		cwd,
		env: { ...process.env, ...env, BENCH_OUT: out },
		encoding: "utf8",
		timeout: 120_000,
	});
	if (!existsSync(out)) throw new Error(`probe captured nothing:\n${(r.stdout + r.stderr).slice(-2000)}`);
	const p = JSON.parse(readFileSync(out, "utf8"));
	// Anthropic: top-level system + tools[].{name,description,input_schema}.
	// OpenAI chat/responses: system/developer messages + tools[].function or tools[].
	const msgs = p.messages ?? p.input ?? [];
	const systemText = [textOf(p.system ?? ""), ...msgs.filter((m) => m.role === "system" || m.role === "developer").map((m) => textOf(m.content))].join("\n");
	const tools = (p.tools ?? []).map((t) => ({ name: t.name ?? t.function?.name, chars: JSON.stringify(t).length }));
	const toolChars = tools.reduce((a, t) => a + t.chars, 0);
	return {
		systemChars: systemText.length,
		toolChars,
		tools: tools.sort((a, b) => b.chars - a.chars),
		tokens: Math.round((systemText.length + toolChars) / CHARS_PER_TOKEN),
		systemTokens: Math.round(systemText.length / CHARS_PER_TOKEN),
		toolTokens: Math.round(toolChars / CHARS_PER_TOKEN),
	};
}

const piVersion = execFileSync(PI, ["--version"], { encoding: "utf8" }).trim();

if (args.includes("--each")) {
	// Stock pi plus one extension (opt-ins enabled), to see what each one costs.
	const units = [];
	const dirsIn = (rel) => readdirSync(join(ROOT, rel), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "opt-in").map((d) => d.name);
	for (const d of dirsIn("extensions")) units.push({ name: d, paths: [join(ROOT, "extensions", d, "index.ts")] });
	for (const d of dirsIn("extensions/opt-in")) units.push({ name: `opt-in/${d}`, paths: [join(ROOT, "extensions/opt-in", d, "index.ts")] });
	units.push({ name: "packages/context", paths: [join(ROOT, "packages/context/index.ts")] });
	units.push({ name: "packages/scheduler", paths: ["durable-scheduler.ts", "session-scheduler.ts"].map((f) => join(ROOT, "packages/scheduler/extensions", f)) });
	units.push({ name: "packages/agent-link", paths: [join(ROOT, "packages/agent-link/index.ts")] });
	units.push({ name: "packages/goal", paths: [join(ROOT, "packages/goal/extensions/goal.ts")] });
	const base = { boot: boot(configs[0].env), context: context(configs[0].env) };
	const rows = [];
	for (const u of units) {
		process.stderr.write(`${u.name}… `);
		const env = { PI_CODING_AGENT_DIR: agentDir(`each-${u.name.replace("/", "-")}`, { extensions: u.paths }, { enable: OPT_INS }) };
		const b = boot(env);
		const c = context(env);
		rows.push({ name: u.name, ms: Math.round(b.main - base.boot.main), wall: Math.round(b.wall - base.boot.wall), tokens: c.tokens - base.context.tokens, tools: c.tools.filter((t) => !base.context.tools.some((x) => x.name === t.name)).map((t) => t.name) });
		process.stderr.write(`${rows.at(-1).ms}ms ${rows.at(-1).tokens}tok\n`);
	}
	rows.sort((a, b) => b.tokens - a.tokens || b.ms - a.ms);
	console.log(`pi ${piVersion} · ${MODEL} · median of ${RUNS} · each row is stock pi + that one extension\n`);
	console.log("| extension | +startup ms | +wall ms | +~tokens | tools |");
	console.log("|---|---|---|---|---|");
	for (const r of rows) console.log(`| ${r.name} | ${r.ms} | ${r.wall} | ${r.tokens.toLocaleString()} | ${r.tools.join(", ")} |`);
	const json = opt("json");
	if (json) writeFileSync(json, `${JSON.stringify({ pi: piVersion, model: MODEL, runs: RUNS, base, rows }, null, 2)}\n`);
	if (!args.includes("--keep")) rmSync(work, { recursive: true, force: true });
	process.exit(0);
}
if (CHECK) {
	// The documented row: "| + Boehsline (defaults) | ... | **5,108** (+2779) |"
	const docs = readFileSync(CHECK, "utf8");
	const m = docs.match(/^\| \+ Boehsline \(defaults\) \|.*\*\*([\d,]+)\*\*/m);
	if (!m) throw new Error(`no "+ Boehsline (defaults)" row with a **total** in ${CHECK}`);
	const documented = Number(m[1].replace(/,/g, ""));
	const tolerance = Number(opt("tolerance", "0.1"));
	const stock = context(configs[0].env).tokens;
	const now = context(configs[1].env).tokens;
	const limit = Math.round(documented * (1 + tolerance));
	const pct = (((now - documented) / documented) * 100).toFixed(1);
	console.log(`pi ${piVersion} · offline stand-in model · starting context`);
	console.log(`  stock pi      ~${stock.toLocaleString()} tokens`);
	console.log(`  + Boehsline   ~${now.toLocaleString()} tokens (Boehsline adds ~${(now - stock).toLocaleString()})`);
	console.log(`  documented    ~${documented.toLocaleString()} tokens in ${CHECK}; limit ${limit.toLocaleString()} (+${tolerance * 100}%)`);
	rmSync(work, { recursive: true, force: true });
	if (now > limit) {
		console.log(`\nFAIL: starting context is ${pct}% over the documented ${documented.toLocaleString()}.`);
		console.log("Trim what grew, or if it's worth it, rerun `node scripts/bench.mjs` and update docs/benchmarks.md.");
		process.exit(1);
	}
	console.log(`\nOK: ${pct}% vs documented.`);
	process.exit(0);
}

const results = { pi: piVersion, model: MODEL, runs: RUNS, node: process.version, platform: `${process.platform}-${process.arch}`, configs: {} };
const NO_BOOT = { wall: NaN, main: NaN, phases: {}, extensions: {} };
for (const c of configs) {
	process.stderr.write(CONTEXT_ONLY ? `${c.name}: ` : `${c.name}: boot ×${RUNS + 1}… `);
	const b = CONTEXT_ONLY ? NO_BOOT : boot(c.env);
	process.stderr.write(`context… `);
	const ctx = context(c.env);
	results.configs[c.name] = { boot: b, context: ctx };
	process.stderr.write(`done (${Math.round(b.wall)}ms, ~${ctx.tokens} tokens)\n`);
}

const s = results.configs.stock;
const rows = Object.entries(results.configs).map(([name, r]) => {
	const d = (a, b) => (name === "stock" ? "" : ` (+${Math.round(a - b)})`);
	return `| ${name} | ${Math.round(r.boot.wall)}${d(r.boot.wall, s.boot.wall)} | ${r.boot.main}${d(r.boot.main, s.boot.main)} | ${r.context.tools.length} | ${r.context.systemTokens.toLocaleString()} | ${r.context.toolTokens.toLocaleString()} | ${r.context.tokens.toLocaleString()}${d(r.context.tokens, s.context.tokens)} |`;
});
console.log(`pi ${piVersion} · ${MODEL} · node ${process.version} · ${results.platform} · median of ${RUNS}\n`);
console.log("| config | wall ms | pi startup ms | tools | system ~tok | tools ~tok | total ~tok |");
console.log("|---|---|---|---|---|---|---|");
console.log(rows.join("\n"));
const json = opt("json");
if (json) writeFileSync(json, `${JSON.stringify(results, null, 2)}\n`);
if (!args.includes("--keep")) rmSync(work, { recursive: true, force: true });
else console.error(`kept ${work}`);
