/**
 * /boehsline: see and change what Boehsline loads.
 *
 *   /boehsline                 a menu: toggle opt-in extensions (one reload when
 *                              it closes), apply default keybindings, show config.
 *                              Without a UI, the same as text.
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
import {
	type AutocompleteItem,
	Key,
	matchesKey,
	type SettingItem,
	SettingsList,
	type SettingsListTheme,
	truncateToWidth,
} from "@earendil-works/pi-tui";
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

async function applyDefaults(ctx: ExtensionCommandContext, force: boolean, reloadAnyway = false): Promise<void> {
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
		ctx.ui.notify(`Keybindings already match Boehsline's defaults.${diff ? `\n${diff}` : ""}`, "info");
		if (reloadAnyway) await ctx.reload();
		return;
	}
	const ok = await ctx.ui.confirm(`Merge Boehsline's keybindings into ${path}?`, diff);
	if (!ok) {
		ctx.ui.notify("Left your keybindings alone.", "info");
		if (reloadAnyway) await ctx.reload();
		return;
	}
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

type MenuResult = { toggles: Map<string, boolean>; action?: "defaults" | "config" };

/** Rows for the menu: opt-ins first, then the two actions. Exported for tests. */
export function menuItems(pendingKeybindings: number): SettingItem[] {
	const known = [...optIns().values()].sort((a, b) => a.name.localeCompare(b.name));
	const width = Math.max("Default keybindings".length, ...known.map((x) => x.name.length));
	return [
		...known.map((x) => ({
			id: `opt:${x.name}`,
			label: x.name.padEnd(width),
			description: x.description,
			currentValue: x.on ? "on" : "off",
			values: ["on", "off"],
		})),
		{
			id: "defaults",
			label: "Default keybindings".padEnd(width),
			description: "Show Boehsline's keybindings as a diff against yours, then merge after you confirm",
			currentValue: pendingKeybindings ? `${pendingKeybindings} to add` : "applied",
		},
		{
			id: "config",
			label: "Merged config".padEnd(width),
			description: "Show the merged config and where each layer comes from",
			currentValue: "show",
		},
	];
}

function pendingKeybindings(): number {
	try {
		return planDefaults(readFlat(keybindingsPath()), readFlat(fileURLToPath(DEFAULT_KEYBINDINGS))).add.length;
	} catch {
		return 0;
	}
}

async function menu(ctx: ExtensionCommandContext): Promise<void> {
	const result = await ctx.ui.custom<MenuResult>((tui, theme, _keybindings, done) => {
		const toggles = new Map<string, boolean>();
		const items = menuItems(pendingKeybindings());
		const listTheme: SettingsListTheme = {
			label: (text, selected) => (selected ? theme.fg("accent", text) : text),
			value: (text, selected) =>
				selected ? theme.fg("accent", text) : theme.fg(text === "off" ? "dim" : text === "on" ? "success" : "muted", text),
			description: (text) => theme.fg("dim", text),
			cursor: theme.fg("accent", "→ "),
			hint: (text) => theme.fg("dim", text),
		};
		const onChange = (id: string, value: string) => {
			const name = id.slice("opt:".length);
			const on = value === "on";
			// Toggling back to where it started is no change at all.
			if (optIns().get(name)?.on === on) toggles.delete(name);
			else toggles.set(name, on);
		};
		const list = new SettingsList(items, Math.min(items.length, 15), listTheme, onChange, () => done({ toggles }));
		// SettingsList keeps its cursor private (as footer.ts reads it too); search is off, so the index is ours.
		const selectedId = () => items[(list as unknown as { selectedIndex?: number }).selectedIndex ?? -1]?.id;
		const header = () => [
			theme.fg("accent", "Boehsline"),
			theme.fg("dim", "j/k select · Enter toggle or run · Esc close (saves toggles, then reloads)"),
			"",
		];
		const footer = (): string[] => {
			const src = [...sources().keys()];
			const lines = ["", theme.fg("dim", `Config: ${userConfigPath()} · Sources: ${src.length ? src.join(", ") : "none"}`)];
			const { error } = readUserConfig();
			if (error) lines.push(theme.fg("warning", `⚠ ${error}`));
			const missing = loadConfig().enable.filter((n) => !optIns().has(n));
			if (missing.length) lines.push(theme.fg("warning", `Enabled but not found: ${missing.join(", ")}`));
			if (toggles.size) lines.push(theme.fg("warning", `● ${toggles.size} change${toggles.size === 1 ? "" : "s"}: saved and reloaded when you close`));
			return lines;
		};
		return {
			// SettingsList's own hint says Esc cancels; here Esc saves, and the header says so.
			render: (width: number) =>
				[...header(), ...list.render(width).filter((l) => !l.includes("Esc to cancel")), ...footer()].map((l) =>
					truncateToWidth(l, width, "…"),
				),
			invalidate: () => list.invalidate(),
			handleInput: (data: string) => {
				const id = selectedId();
				const activate = matchesKey(data, Key.enter) || data === " ";
				if (activate && (id === "defaults" || id === "config")) return done({ toggles, action: id });
				if (data === "j") list.handleInput("\x1b[B");
				else if (data === "k") list.handleInput("\x1b[A");
				else list.handleInput(data);
				tui.requestRender();
			},
			handleMouse: (event) => list.handleMouse({ ...event, y: event.y - header().length }),
		};
	});
	if (!result) return;
	if (result.toggles.size) {
		try {
			for (const [name, on] of result.toggles) setEnabled(name, on);
		} catch (err) {
			return ctx.ui.notify((err as Error).message, "error");
		}
		const summary = [...result.toggles].map(([n, on]) => `${on ? "+" : "-"}${n}`).join(" ");
		// A pending action still runs; it reloads too, or the reload happens here.
		if (result.action === "defaults") {
			ctx.ui.notify(`Saved ${summary}.`, "info");
			return applyDefaults(ctx, false, true);
		}
		if (result.action === "config") ctx.ui.notify(configText(), "info");
		ctx.ui.notify(`Saved ${summary}. Reloading…`, "info");
		return ctx.reload();
	}
	if (result.action === "defaults") return applyDefaults(ctx, false);
	if (result.action === "config") return ctx.ui.notify(configText(), "info");
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
		description: "Boehsline: a menu to toggle opt-in extensions, apply default keybindings, show config",
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
			if (!sub) return ctx.hasUI ? menu(ctx) : ctx.ui.notify(statusText(), "info");
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
