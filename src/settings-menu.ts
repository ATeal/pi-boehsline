import type {
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	getSelectListTheme,
	getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	decodeKittyPrintable,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
} from "@earendil-works/pi-tui";
import {
	type GuardianConfigObject,
	readGuardianConfigObject,
	setConfigValue,
	setReviewRule,
	updateGuardianConfigFile,
} from "./config-file.ts";
import {
	DEFAULT_REVIEW_RULES,
	type GuardianConfig,
	loadGuardianConfig,
	type ReviewLevel,
} from "./config.ts";
import { formatDuration } from "./review-presentation.ts";
import { DEFAULT_REVIEWER_MODEL, REVIEW_TIMEOUT_MS } from "./review.ts";

const REVIEW_LEVELS: readonly ReviewLevel[] = [
	"always",
	"outside-or-private",
	"private-only",
	"off",
];
const TIMEOUT_PRESETS_MS: readonly number[] = [
	15_000, 30_000, 60_000, 90_000, 120_000, 180_000, 300_000,
];

const BYPASS_ENABLED = "enabled";
const BYPASS_ACTIVE = "BYPASSED";

export interface GuardianSettingsDeps {
	isBypassed: () => boolean;
	setBypass: (active: boolean, ctx: ExtensionContext) => void;
	showStatus: (ctx: ExtensionCommandContext) => Promise<void>;
}

type MenuResult = "close" | "edit-policy" | "status";

export function defaultLabel(value: string): string {
	return `default (${value})`;
}

function sourceNote(source: string, effective: string): string {
	return source === "environment" || source === "project"
		? ` Effective value ${effective} comes from the ${source} and overrides this global setting.`
		: "";
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function reviewRulesOf(raw: GuardianConfigObject): Record<string, unknown> {
	return raw.review && typeof raw.review === "object" && !Array.isArray(raw.review)
		? (raw.review as Record<string, unknown>)
		: {};
}

/** Build the settings rows from the global file and the effective config. */
export function buildSettingItems(options: {
	raw: GuardianConfigObject;
	config: GuardianConfig;
	modelSpecs: string[];
	bypassed: boolean;
	modelSubmenu: (id: string, values: string[]) => SettingItem["submenu"];
	actionSubmenu: (action: MenuResult) => SettingItem["submenu"];
}): SettingItem[] {
	const { raw, config, modelSpecs, bypassed } = options;
	const defaultModel = defaultLabel(DEFAULT_REVIEWER_MODEL);
	const modelValues = [defaultModel, ...modelSpecs];
	const modelItem = (
		id: "model" | "fallbackModel",
		label: string,
		purpose: string,
		source: string,
		effective: string,
	): SettingItem => ({
		id,
		label,
		currentValue: stringValue(raw[id]) ?? defaultModel,
		description: `${purpose}${sourceNote(source, effective)}`,
		submenu: options.modelSubmenu(id, modelValues),
	});

	const rawTimeout = typeof raw.timeoutMs === "number" ? raw.timeoutMs : undefined;
	const timeoutValues = [
		defaultLabel(formatDuration(REVIEW_TIMEOUT_MS)),
		...[...new Set([...TIMEOUT_PRESETS_MS, ...(rawTimeout ? [rawTimeout] : [])])]
			.sort((left, right) => left - right)
			.map(formatDuration),
	];

	const globalRules = reviewRulesOf(raw);
	const ruleKeys = [
		...new Set([...Object.keys(DEFAULT_REVIEW_RULES), ...Object.keys(globalRules)]),
	];
	const ruleItems = ruleKeys.map((key): SettingItem => {
		const fallback = DEFAULT_REVIEW_RULES[key] ?? "private-only";
		const globalLevel = stringValue(globalRules[key]);
		const effective = config.review[key];
		const tightened =
			effective && effective !== (globalLevel ?? fallback)
				? ` A trusted project config tightens this to ${effective}.`
				: "";
		return {
			id: `review:${key}`,
			label: `  ${key}`,
			currentValue: globalLevel ?? defaultLabel(fallback),
			values: [defaultLabel(fallback), ...REVIEW_LEVELS],
			description: `When ${key} triggers a reviewer: always, only outside the project or for private data, only for private data, or never.${tightened}`,
		};
	});

	const policySources = config.policySources.filter((source) => source !== "global");
	return [
		{
			id: "bypass",
			label: "Guardian",
			currentValue: bypassed ? BYPASS_ACTIVE : BYPASS_ENABLED,
			values: [BYPASS_ENABLED, BYPASS_ACTIVE],
			description:
				"Temporarily bypass Guardian review for this session (same as /approval-guardian bypass / enable). Not saved to config.",
		},
		modelItem(
			"model",
			"Reviewer model",
			"Primary model that reviews covered tool calls.",
			config.modelSource,
			config.model,
		),
		modelItem(
			"fallbackModel",
			"Fallback model",
			"Used when the primary reviewer is unavailable.",
			config.fallbackModelSource,
			config.fallbackModel,
		),
		{
			id: "timeoutMs",
			label: "Review timeout",
			currentValue:
				rawTimeout !== undefined ? formatDuration(rawTimeout) : timeoutValues[0],
			values: timeoutValues,
			description: `Deadline per reviewer attempt.${sourceNote(config.timeoutSource, formatDuration(config.timeoutMs))}`,
		},
		{
			id: "policy",
			label: "Custom policy",
			currentValue: stringValue(raw.policy) ? "custom" : "none",
			description: `Extra reviewer instructions; Enter opens an editor (empty clears it).${
				policySources.length > 0
					? ` Also appended from: ${policySources.join(", ")}.`
					: ""
			}`,
			submenu: options.actionSubmenu("edit-policy"),
		},
		{
			id: "review-header",
			label: "Review rules",
			currentValue: "",
			description: "Per tool/parameter review scope. Trusted project configs can only tighten these.",
		},
		...ruleItems,
		{
			id: "status",
			label: "Show full status",
			currentValue: "↵",
			description: "Close this menu and print reviewer readiness, channels, and warnings.",
			submenu: options.actionSubmenu("status"),
		},
	];
}

/** Translate a settings change into a global config mutation. */
export function applySettingChange(
	raw: GuardianConfigObject,
	id: string,
	value: string,
): void {
	const isDefault = value.startsWith("default (");
	if (id === "model" || id === "fallbackModel") {
		setConfigValue(raw, id, isDefault ? undefined : value);
	} else if (id === "timeoutMs") {
		setConfigValue(raw, id, isDefault ? undefined : parseDurationLabel(value));
	} else if (id.startsWith("review:")) {
		setReviewRule(raw, id.slice("review:".length), isDefault ? undefined : value);
	} else {
		throw new Error(`Unknown Guardian setting: ${id}`);
	}
}

function parseDurationLabel(value: string): number {
	const match = /^(\d+)(ms|s)$/.exec(value);
	if (!match) throw new Error(`Invalid duration: ${value}`);
	return Number(match[1]) * (match[2] === "s" ? 1000 : 1);
}

/** Case-insensitive match where every whitespace-separated term is a substring. */
export function matchesAllTerms(value: string, filter: string): boolean {
	const haystack = value.toLowerCase();
	return filter
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((term) => haystack.includes(term));
}

class FilterableSelect implements Component {
	private filter = "";
	private list: SelectList;
	private readonly title: string;
	private readonly items: SelectItem[];
	private readonly fg: (color: "dim" | "accent", text: string) => string;
	private readonly done: (value?: string) => void;

	constructor(
		title: string,
		items: SelectItem[],
		current: string,
		fg: (color: "dim" | "accent", text: string) => string,
		done: (value?: string) => void,
	) {
		this.title = title;
		this.items = items;
		this.fg = fg;
		this.done = done;
		this.list = this.buildList(items);
		const index = items.findIndex((item) => item.value === current);
		if (index >= 0) this.list.setSelectedIndex(index);
	}

	private buildList(items: SelectItem[]): SelectList {
		const list = new SelectList(items, 12, getSelectListTheme());
		list.onSelect = (item) => this.done(item.value);
		list.onCancel = () => this.done();
		return list;
	}

	private applyFilter(): void {
		this.list = this.buildList(
			this.filter
				? this.items.filter((item) => matchesAllTerms(item.value, this.filter))
				: this.items,
		);
	}

	render(width: number): string[] {
		return [
			this.fg("accent", this.title),
			this.fg("dim", `Filter: ${this.filter || "(type to filter)"}`),
			...this.list.render(width),
		];
	}

	invalidate(): void {
		this.list.invalidate();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.backspace)) {
			this.filter = this.filter.slice(0, -1);
			this.applyFilter();
			return;
		}
		const printable =
			decodeKittyPrintable(data) ??
			(data.length === 1 && data >= " " && data !== "\x7f" ? data : undefined);
		if (printable && (printable !== " " || this.filter.length > 0)) {
			this.filter += printable;
			this.applyFilter();
			return;
		}
		this.list.handleInput(data);
	}
}

async function showMenu(
	ctx: ExtensionCommandContext,
	deps: GuardianSettingsDeps,
): Promise<MenuResult> {
	const config = loadGuardianConfig({
		cwd: ctx.cwd,
		projectTrusted: ctx.isProjectTrusted(),
	});
	const path = config.globalPath;
	const raw = readGuardianConfigObject(path);
	const modelSpecs = ctx.modelRegistry
		.getAvailable()
		.map((model) => `${model.provider}/${model.id}`)
		.sort();

	return ctx.ui.custom<MenuResult>((tui, theme, _keybindings, done) => {
		const fg = (color: "dim" | "accent", text: string) => theme.fg(color, text);
		const items = buildSettingItems({
			raw,
			config,
			modelSpecs,
			bypassed: deps.isBypassed(),
			modelSubmenu: (id, values) => (current, submenuDone) =>
				new FilterableSelect(
					id === "model" ? "Reviewer model" : "Fallback model",
					values.map((value) => ({ value, label: value })),
					current,
					fg,
					submenuDone,
				),
			actionSubmenu: (action) => (_current, submenuDone) => {
				queueMicrotask(() => {
					submenuDone();
					done(action);
				});
				return { render: () => [], invalidate: () => undefined };
			},
		});
		let error: string | undefined;
		const list = new SettingsList(
			items,
			Math.min(items.length, Math.max(8, tui.terminal.rows - 10)),
			getSettingsListTheme(),
			(id, value) => {
				error = undefined;
				try {
					if (id === "bypass") {
						deps.setBypass(value === BYPASS_ACTIVE, ctx);
						list.updateValue(id, deps.isBypassed() ? BYPASS_ACTIVE : BYPASS_ENABLED);
					} else if (id !== "review-header") {
						updateGuardianConfigFile(path, (next) => applySettingChange(next, id, value));
					}
				} catch (caught) {
					error = `Not saved: ${caught instanceof Error ? caught.message : String(caught)}`;
				}
				tui.requestRender();
			},
			() => done("close"),
			{ enableSearch: true },
		);
		return {
			render(width: number) {
				return [
					theme.fg("accent", theme.bold("Approval Guardian settings")),
					theme.fg("dim", `Saving to ${path}`),
					...(error ? [theme.fg("error", error)] : []),
					"",
					...list.render(width),
				];
			},
			invalidate: () => list.invalidate(),
			handleInput(data: string) {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

async function editPolicy(ctx: ExtensionCommandContext): Promise<void> {
	const path = loadGuardianConfig({
		cwd: ctx.cwd,
		projectTrusted: ctx.isProjectTrusted(),
	}).globalPath;
	const current = stringValue(readGuardianConfigObject(path).policy) ?? "";
	const edited = await ctx.ui.editor("Approval Guardian policy (global; empty clears)", current);
	if (edited === undefined) return;
	const policy = edited.trim();
	if (policy === current) return;
	updateGuardianConfigFile(path, (raw) => setConfigValue(raw, "policy", policy || undefined));
	ctx.ui.notify(policy ? "Guardian policy saved." : "Guardian policy cleared.", "info");
}

/** Open the interactive settings menu. Loops back after editing the policy. */
export async function openGuardianSettings(
	ctx: ExtensionCommandContext,
	deps: GuardianSettingsDeps,
): Promise<void> {
	for (;;) {
		let result: MenuResult;
		try {
			result = await showMenu(ctx, deps);
		} catch (error) {
			ctx.ui.notify(
				`Cannot open Guardian settings: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
			return;
		}
		if (result === "edit-policy") {
			try {
				await editPolicy(ctx);
			} catch (error) {
				ctx.ui.notify(
					`Guardian policy not saved: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
			continue;
		}
		if (result === "status") await deps.showStatus(ctx);
		return;
	}
}
