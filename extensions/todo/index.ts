/**
 * todo — lean shared task list for pi (you + any number of agents).
 *
 * - `todo` tool: list | add | claim | release | done | block | drop | edit
 * - `/todo` command for you: same ops plus assign, rm, clear, hide/show, path
 * - one static line above the editor (no spinner, no reminders)
 * - store: markdown checklist at .pi/TODO.md; claims are a locked compare-and-set,
 *   so two agents can never both own a task (see store.ts)
 *
 * Identity: agents are `pi-<last 4 of session id>` (override: PI_TODO_AGENT);
 * you are your OS username (override: PI_TODO_USER). /todo actions always win.
 * File: PI_TODO_FILE (relative to cwd) overrides .pi/TODO.md.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { userInfo } from "node:os";
import { relative, resolve } from "node:path";
import { applyOp, fmt, isOpen, type Item, items, type Op, TodoStore } from "./store.ts";

const TOOL_OPS = ["list", "add", "claim", "release", "done", "block", "drop", "edit"] as const;
const CMD_OPS = ["add", "claim", "release", "done", "block", "drop", "edit", "assign", "rm", "clear", "hide", "show", "path"];

const slug = (s?: string) => s?.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || undefined;
const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

function color(it: Item, th: Theme, me: string): string {
	const line = fmt(it, me);
	if (it.status === "done" || it.status === "dropped") return th.fg("dim", line);
	if (it.status === "blocked") return th.fg("warning", line);
	if (it.status === "active") return th.fg(it.owner === me ? "accent" : "text", line);
	return th.fg("muted", line);
}

/** One static line: progress · active tasks (with owners) · blocked count. */
function widgetLines(all: Item[], me: string, th: Theme, width: number): string[] {
	const open = all.filter(isOpen);
	if (!open.length) return [];
	const done = all.filter((i) => i.status === "done").length;
	const active = open.filter((i) => i.status === "active");
	const parts = [th.fg("dim", `todo ${done}/${done + open.length}`)];
	for (const i of active) {
		const who = i.owner ? th.fg("dim", ` @${i.owner}`) : "";
		parts.push(th.fg(i.owner === me ? "accent" : "muted", `#${i.id} ${truncateToWidth(i.text, 40)}`) + who);
	}
	const next = open.find((i) => i.status === "open" && !i.owner);
	if (!active.length && next) parts.push(th.fg("muted", `next #${next.id} ${truncateToWidth(next.text, 40)}`));
	const blocked = open.length - active.length - open.filter((i) => i.status === "open").length;
	if (blocked) parts.push(th.fg("warning", `${blocked} blocked`));
	return [truncateToWidth(parts.join(th.fg("dim", " · ")), width)];
}

export default function (pi: ExtensionAPI) {
	let store: TodoStore | undefined;
	let agent = "pi";
	let hidden = false;
	let requestRender: (() => void) | undefined;
	const human = slug(process.env.PI_TODO_USER) ?? slug(userInfo().username) ?? "user";

	const need = () => {
		if (!store) throw new Error("todo: no active session");
		return store;
	};

	function mountWidget(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		if (hidden) {
			ctx.ui.setWidget("todo", undefined);
			requestRender = undefined;
			return;
		}
		ctx.ui.setWidget(
			"todo",
			(tui, theme) => {
				requestRender = () => tui.requestRender();
				return { render: (w: number) => widgetLines(store?.items() ?? [], agent, theme, w), invalidate() {} };
			},
			{ placement: "aboveEditor" },
		);
	}

	pi.on("session_start", (_e, ctx) => {
		const sid = ctx.sessionManager.getSessionId().replace(/[^a-z0-9]/gi, "");
		agent = slug(process.env.PI_TODO_AGENT) ?? `pi-${sid.slice(-4) || "anon"}`;
		const path = resolve(ctx.cwd, process.env.PI_TODO_FILE || ".pi/TODO.md");
		if (store?.path !== path) {
			store?.stop();
			store = new TodoStore(path, () => requestRender?.());
		}
		store.refresh();
		store.startWatch();
		mountWidget(ctx);
	});

	pi.on("session_shutdown", () => {
		store?.stop();
		store = undefined;
		requestRender = undefined;
	});

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description:
			"Shared task list for this project (.pi/TODO.md), used by the user and other pi agents. " +
			"Claim a task before working on it, mark it done when finished. " +
			"Tasks owned by someone else are locked; use force only if the user asks.",
		parameters: Type.Object({
			op: StringEnum(TOOL_OPS),
			id: Type.Optional(Type.Number()),
			text: Type.Optional(Type.String({ description: "add/edit: task text; block: reason" })),
			all: Type.Optional(Type.Boolean({ description: "list: include done/dropped" })),
			force: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, p) {
			const s = need();
			if (p.op === "list") {
				const list = items(await s.list()).filter((i) => p.all || isOpen(i));
				const scope = p.all ? "" : "open ";
				return textResult(
					list.length
						? `You are @${agent}. ${list.length} ${scope}task(s):\n${list.map((i) => fmt(i, agent)).join("\n")}`
						: `You are @${agent}. No ${scope}tasks.`,
				);
			}
			const args = { who: agent, id: p.id, text: p.text, force: p.force };
			return textResult(await s.apply((doc) => applyOp(doc, p.op as Op, args)));
		},
		renderCall(args, theme) {
			let t = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", String(args.op ?? ""));
			if (args.id !== undefined) t += ` ${theme.fg("accent", `#${args.id}`)}`;
			if (args.text) t += ` ${theme.fg("dim", String(args.text))}`;
			if (args.force) t += theme.fg("warning", " (force)");
			return new Text(t, 0, 0);
		},
	});

	async function showList(ctx: ExtensionContext) {
		const s = need();
		const all = items(await s.list());
		const sorted = [...all.filter(isOpen), ...all.filter((i) => !isOpen(i))];
		const title = `Tasks · ${relative(ctx.cwd, s.path)} · you are @${human}`;
		if (ctx.mode !== "tui") {
			const lines = sorted.length ? sorted.map((i) => fmt(i, human)) : ["No tasks."];
			ctx.ui.notify([title, ...lines].join("\n"), "info");
			return;
		}
		await ctx.ui.custom<void>((_tui, theme, _kb, done) => ({
			render: (w: number) =>
				[
					"",
					theme.fg("accent", ` ${title}`),
					"",
					...(sorted.length ? sorted.map((i) => `  ${color(i, theme, agent)}`) : [theme.fg("dim", "  No tasks yet.")]),
					"",
					theme.fg("dim", "  Esc to close · edit the file directly or use /todo <op>"),
				].map((l) => truncateToWidth(l, w)),
			invalidate() {},
			handleInput(data: string) {
				if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "ctrl+c")) done();
			},
		}));
	}

	pi.registerCommand("todo", {
		description:
			"Shared tasks: /todo [add <text> | claim|release|done|drop|rm <id> | block <id> <why> | edit <id> <text> | assign <id> <name|-> | clear | hide | show | path]",
		getArgumentCompletions: (prefix) => {
			if (prefix.includes(" ")) return null;
			const hits = CMD_OPS.filter((o) => o.startsWith(prefix)).map((o) => ({ value: o, label: o }));
			return hits.length ? hits : null;
		},
		handler: async (args, ctx) => {
			const [, sub = "", tail = ""] = /^(\S*)\s*([\s\S]*)$/.exec(args.trim()) ?? [];
			try {
				if (!sub) return await showList(ctx);
				if (sub === "hide" || sub === "show") {
					hidden = sub === "hide";
					mountWidget(ctx);
					return;
				}
				if (sub === "path") return ctx.ui.notify(need().path, "info");
				if (!CMD_OPS.includes(sub)) throw new Error(`Unknown /todo op: ${sub}`);
				const m = /^#?(\d+)\s*([\s\S]*)$/.exec(tail);
				const a = sub === "add" || sub === "clear" ? { text: tail } : { id: m ? Number(m[1]) : undefined, text: m?.[2] };
				const msg = await need().apply((doc) => applyOp(doc, sub as Op, { ...a, who: human, force: true }));
				ctx.ui.notify(msg, "info");
			} catch (e) {
				ctx.ui.notify(e instanceof Error ? e.message : String(e), "error");
			}
		},
	});
}
