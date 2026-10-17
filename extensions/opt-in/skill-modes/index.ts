/**
 * skill-modes: sticky skill modes, the way Cursor runs them.
 *
 * A skill with `mode: true` in its frontmatter becomes sticky once you invoke it
 * with `/skill:<name>`. While a mode is on, every agent run gets one small
 * system prompt section (`<skill_modes>`): the skill's `reminder:` line plus
 * where the skill lives. The model re-applies the skill on new tasks and stays
 * out of the way on casual turns. The skill body is not re-injected. After
 * compaction drops it, the model re-reads SKILL.md when the reminder applies.
 *
 * Opt-in: `/boehsline enable skill-modes`.
 *
 *   /mode             list active modes
 *   /mode off         leave every mode
 *   /mode off <name>  leave one mode
 *
 * Built for pstack's /poteto-mode, but generic: any skill with `mode: true`
 * works, including ones written by pstack's /automate-me.
 *
 * Activation uses public surfaces only. The `input` event sees the raw
 * `/skill:<name>` before pi expands it, and the next `before_agent_start`
 * resolves the name through `systemPromptOptions.skills` (which lists hidden
 * skills too). A skill queued mid-stream therefore enters on the next run.
 *
 * State is a session entry (customType "skill-mode") holding the active list,
 * rebuilt from the current branch on session_start and session_tree, so a mode
 * survives /resume, /tree, /fork, /reload and compaction. Footer badge via
 * setStatus, styled from frontmatter `icon`/`color` when known. The section is
 * constant while a mode is on, so it doesn't churn the prompt cache, and it is
 * absent (zero cost) while no mode is on. Never edits a SKILL.md.
 */

import { readFileSync } from "node:fs";
import { type ExtensionAPI, type ExtensionContext, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { optIn } from "../../../lib/opt-in.ts";

const ENTRY = "skill-mode";
const SECTION = "skill_modes";

interface Mode {
	name: string;
	filePath: string;
}

interface Meta {
	mode: boolean;
	reminder?: string;
	icon?: string;
	color?: string;
}

// Cursor icon/color names from frontmatter, mapped to what a terminal can show.
const ICONS: Record<string, string> = { crown: "👑", star: "★", bolt: "⚡", flame: "🔥", sparkles: "✨" };
type Tone = "warning" | "error" | "success" | "accent";
const TONES: Record<string, Tone> = {
	yellow: "warning",
	orange: "warning",
	red: "error",
	green: "success",
	blue: "accent",
	cyan: "accent",
	purple: "accent",
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function skillModes(pi: ExtensionAPI) {
	let active: Mode[] = [];
	const pending = new Set<string>();
	const metaCache = new Map<string, Meta | undefined>();

	function meta(filePath: string): Meta | undefined {
		if (!metaCache.has(filePath)) {
			try {
				const { frontmatter: fm } = parseFrontmatter(readFileSync(filePath, "utf-8"));
				metaCache.set(filePath, {
					mode: fm.mode === true,
					reminder: str(fm.reminder),
					icon: str(fm.icon),
					color: str(fm.color),
				});
			} catch {
				metaCache.set(filePath, undefined);
			}
		}
		return metaCache.get(filePath);
	}

	function render(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		if (active.length === 0) {
			ctx.ui.setStatus(ENTRY, undefined);
			return;
		}
		const badges = active.map((m) => {
			const info = meta(m.filePath);
			const icon = ICONS[info?.icon ?? ""] ?? "◆";
			return ctx.ui.theme.fg(TONES[info?.color ?? ""] ?? "accent", `${icon} ${m.name}`);
		});
		ctx.ui.setStatus(ENTRY, badges.join(" "));
	}

	function save(ctx: ExtensionContext) {
		pi.appendEntry<{ modes: Mode[] }>(ENTRY, { modes: active });
		render(ctx);
	}

	function restore(ctx: ExtensionContext) {
		active = [];
		pending.clear();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === ENTRY) {
				active = (entry.data as { modes?: Mode[] } | undefined)?.modes ?? [];
			}
		}
		render(ctx);
	}

	function section(): string {
		const lines = active.map((m) => {
			const reminder = meta(m.filePath)?.reminder ?? `Apply /${m.name} when the task calls for it.`;
			return `- ${m.name} (${m.filePath}): ${reminder}`;
		});
		return [
			"Sticky skill modes are on. The user entered each with /skill:<name>, and it stays on until they leave it.",
			...lines,
			"When a reminder says to apply a mode and its SKILL.md is no longer in context (for example after compaction), read it in full first. If the user opts out in chat, stop applying it and tell them `/mode off` clears this reminder.",
		].join("\n");
	}

	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));

	pi.on("input", (event) => {
		const name = /^\/skill:(\S+)/.exec(event.text)?.[1];
		if (name) pending.add(name);
		return { action: "continue" };
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (pending.size > 0) {
			let changed = false;
			for (const name of pending) {
				if (active.some((m) => m.name === name)) continue;
				const skill = event.systemPromptOptions.skills.find((s) => s.name === name);
				if (skill && meta(skill.filePath)?.mode) {
					active.push({ name, filePath: skill.filePath });
					changed = true;
				}
			}
			pending.clear();
			if (changed) save(ctx);
		}

		const sections = event.systemPromptOptions.sections;
		if (active.length === 0) delete sections[SECTION];
		else sections[SECTION] = section();
	});

	pi.registerCommand("mode", {
		description: "Sticky skill modes: list them, or `off [name]` to leave",
		handler: async (args, ctx) => {
			const [verb, name] = args.trim().split(/\s+/).filter(Boolean);
			if (!verb) {
				ctx.ui.notify(
					active.length
						? `Active: ${active.map((m) => m.name).join(", ")}. Leave with /mode off [name].`
						: "No mode on. Enter one with /skill:<name> (the skill needs `mode: true`).",
					"info",
				);
				return;
			}
			if (verb !== "off") {
				ctx.ui.notify("Usage: /mode, /mode off, /mode off <name>", "warning");
				return;
			}
			const before = active.length;
			active = name ? active.filter((m) => m.name !== name) : [];
			if (active.length === before) {
				ctx.ui.notify(name ? `${name} is not on.` : "No mode on.", "info");
				return;
			}
			save(ctx);
			ctx.ui.notify(name ? `Left ${name}.` : "Left every mode.", "info");
		},
	});
}

export default optIn("skill-modes", "Sticky skill modes: /skill:<name> stays on until /mode off", skillModes);
