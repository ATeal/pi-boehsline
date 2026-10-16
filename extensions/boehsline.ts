/**
 * /boehsline: see and change what Boehsline loads.
 *
 *   /boehsline                 opt-in extensions, on or off, plus config sources
 *   /boehsline enable <name>   turn an opt-in extension on (writes boehsline.json, reloads)
 *   /boehsline disable <name>  turn it off
 *   /boehsline config          the merged config, and where each layer comes from
 *   /boehsline defaults [--force]   show Boehsline's keybindings as a diff against
 *                              yours, then merge them after you confirm (only keys
 *                              you haven't set; --force replaces yours too)
 *
 * Core extensions are turned off with pi's own tools (`pi config`, or a filter
 * on the package entry in settings.json), not here.
 */

import { mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ExtensionAPI, type ExtensionCommandContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { loadConfig, optIns, readUserConfig, setEnabled, sources, userConfigPath } from "../lib/config.ts";
import { changes, diffText, planDefaults, readFlat, unresolvedConflicts } from "../lib/defaults.ts";

const DEFAULT_KEYBINDINGS = new URL("../defaults/keybindings.json", import.meta.url);
const keybindingsPath = () => join(getAgentDir(), "keybindings.json");

/** Write through a symlink (dotfiles often link keybindings.json), atomically. */
function writeJson(path: string, value: unknown): void {
	let target = path;
	try {
		target = realpathSync(path);
	} catch {
		// new file
	}
	mkdirSync(dirname(target), { recursive: true });
	const tmp = `${target}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
	renameSync(tmp, target);
}

async function applyDefaults(ctx: ExtensionCommandContext, force: boolean): Promise<void> {
	const path = keybindingsPath();
	let user: ReturnType<typeof readFlat>;
	try {
		user = readFlat(path);
	} catch (err) {
		return ctx.ui.notify(`Not touching a broken file: ${(err as Error).message}`, "error");
	}
	const plan = planDefaults(user, readFlat(fileURLToPath(DEFAULT_KEYBINDINGS)), force);
	const diff = diffText(plan, force);
	if (!changes(plan, force)) {
		return ctx.ui.notify(`Keybindings already match Boehsline's defaults.${diff ? `\n${diff}` : ""}`, "info");
	}
	const ok = await ctx.ui.confirm(`Merge Boehsline's keybindings into ${path}?`, diff);
	if (!ok) return ctx.ui.notify("Left your keybindings alone.", "info");
	writeJson(path, plan.merged);
	ctx.ui.notify(`Updated ${path}. Reloading…`, "info");
	await ctx.reload();
}

function statusText(): string {
	const lines: string[] = [];
	const known = [...optIns().values()].sort((a, b) => a.name.localeCompare(b.name));
	lines.push("Opt-in extensions:");
	if (known.length === 0) lines.push("  (none installed yet)");
	for (const x of known) lines.push(`  ${x.on ? "●" : "○"} ${x.name.padEnd(18)} ${x.description}`);

	const enabledButMissing = loadConfig().enable.filter((n) => !optIns().has(n));
	if (enabledButMissing.length) lines.push(`  Enabled but not found: ${enabledButMissing.join(", ")}`);

	const src = [...sources().keys()];
	lines.push("", `Config: ${userConfigPath()}`);
	lines.push(`Sources: ${src.length ? src.join(", ") : "none"}`);
	const { error } = readUserConfig();
	if (error) lines.push(`⚠ ${error}`);
	lines.push("", "/boehsline enable <name> · disable <name> · config · defaults");
	return lines.join("\n");
}

function configText(): string {
	const { config: user, error } = readUserConfig();
	const parts = [`Merged:\n${JSON.stringify(loadConfig(), null, 2)}`];
	for (const [name, config] of sources()) parts.push(`Source ${name}:\n${JSON.stringify(config, null, 2)}`);
	parts.push(`User file (${userConfigPath()}):\n${error ? `⚠ ${error}` : JSON.stringify(user, null, 2)}`);
	return parts.join("\n\n");
}

export default function boehsline(pi: ExtensionAPI): void {
	// Once per session, while stash or prompt-history still fight pi for a key.
	pi.on("session_start", (_e, ctx) => {
		if (!ctx.hasUI) return;
		let user: ReturnType<typeof readFlat>;
		try {
			user = readFlat(keybindingsPath());
		} catch {
			return;
		}
		const open = unresolvedConflicts(user);
		if (!open.length) return;
		const keys = open.map((c) => `${c.key} (${c.by})`).join(" and ");
		ctx.ui.notify(`Boehsline uses ${keys}, which pi also binds. /boehsline defaults moves pi's to Alt.`, "info");
	});

	pi.registerCommand("boehsline", {
		description: "Boehsline: list opt-in extensions, enable/disable them, show config",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] => {
			const [sub = "", name = ""] = prefix.split(/\s+/);
			if (prefix.includes(" ") && (sub === "enable" || sub === "disable")) {
				return [...optIns().values()]
					.filter((x) => (sub === "enable" ? !x.on : x.on) && x.name.startsWith(name))
					.map((x) => ({ value: `${sub} ${x.name}`, label: x.name, description: x.description }));
			}
			return ["enable", "disable", "config", "defaults"]
				.filter((s) => s.startsWith(sub))
				.map((s) => ({ value: `${s} `, label: s }));
		},
		handler: async (args, ctx) => {
			const [sub, name] = (args ?? "").trim().split(/\s+/);
			if (!sub) return ctx.ui.notify(statusText(), "info");
			if (sub === "config") return ctx.ui.notify(configText(), "info");
			if (sub === "defaults") return applyDefaults(ctx, name === "--force");
			if (sub === "enable" || sub === "disable") {
				if (!name) return ctx.ui.notify(`Usage: /boehsline ${sub} <name>`, "warning");
				const on = sub === "enable";
				if (!optIns().has(name)) ctx.ui.notify(`"${name}" isn't an installed opt-in extension; writing it anyway.`, "warning");
				try {
					setEnabled(name, on);
				} catch (err) {
					return ctx.ui.notify((err as Error).message, "error");
				}
				ctx.ui.notify(`${on ? "Enabled" : "Disabled"} ${name}. Reloading…`, "info");
				await ctx.reload();
				return;
			}
			ctx.ui.notify(`Unknown subcommand "${sub}".\n\n${statusText()}`, "warning");
		},
	});
}
