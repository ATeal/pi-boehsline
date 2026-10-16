/**
 * Boehsline configuration: which opt-in extensions are on, and per-extension
 * settings.
 *
 * Layers, lowest to highest precedence:
 *   1. Defaults written in each extension's code (neutral, nothing personal).
 *   2. Config sources: other packages, such as a private pi-boehsline-va,
 *      that register settings through the global registry below.
 *   3. The user file, ~/.pi/agent/boehsline.json (or $BOEHSLINE_CONFIG).
 *
 * Objects deep-merge; arrays and scalars replace.
 *
 * Only the user file (plus $BOEHSLINE_ENABLE, a comma list for tests and
 * one-off `pi -e` runs) controls `enable`. An opt-in extension decides whether to
 * load inside its factory, and pi does not guarantee the order packages load in,
 * so a source that loads later could not reliably turn one on. Sources supply
 * settings, which extensions read lazily (at session_start or on use), so for
 * settings the load order does not matter.
 *
 * Why a globalThis registry rather than imports: installed pi packages load
 * with separate module roots, so a second package cannot import this module and
 * share its state. A Symbol.for key on globalThis is shared across the whole
 * process. Sources are keyed by name, so /reload replaces an entry instead of
 * piling up duplicates.
 *
 * Source contract (no Boehsline import needed):
 *
 *   const key = Symbol.for("boehsline.config.sources");
 *   ((globalThis as any)[key] ??= new Map()).set("pi-boehsline-va", { watch: { … } });
 *
 * Pure node: no pi imports, so tests run under plain `node --test`.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ConfigObject = { [key: string]: Json };

export interface BoehslineConfig extends ConfigObject {
	/** Opt-in extensions to load. Only read from the user file. */
	enable: string[];
}

export const SOURCES_KEY = Symbol.for("boehsline.config.sources");
export const OPT_INS_KEY = Symbol.for("boehsline.optins");

type Registry = Map<string, ConfigObject>;

export function sources(): Registry {
	const g = globalThis as unknown as Record<symbol, Registry | undefined>;
	return (g[SOURCES_KEY] ??= new Map());
}

/** Register (or replace) a named config source. Settings only; `enable` is ignored. */
export function registerSource(name: string, config: ConfigObject): void {
	sources().set(name, config);
}

export function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
	return env.BOEHSLINE_CONFIG || join(homedir(), ".pi", "agent", "boehsline.json");
}

function isPlainObject(value: unknown): value is ConfigObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys starting with "//" are comments in the JSON files and never reach extensions. */
const isComment = (key: string): boolean => key.startsWith("//");

/** Deep merge: objects merge key by key; arrays and scalars from `over` replace. Comment keys are dropped. */
export function merge(base: ConfigObject, over: ConfigObject): ConfigObject {
	const out: ConfigObject = { ...base };
	for (const [key, value] of Object.entries(over)) {
		if (isComment(key)) continue;
		const prev = out[key];
		out[key] = isPlainObject(value) ? merge(isPlainObject(prev) ? prev : {}, value) : value;
	}
	return out;
}

export interface ReadResult {
	config: ConfigObject;
	error?: string;
}

/** Read the user file. A missing file is an empty config; a broken one is reported, not thrown. */
export function readUserConfig(path = userConfigPath()): ReadResult {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return { config: {} };
	}
	try {
		const parsed: unknown = JSON.parse(text);
		if (!isPlainObject(parsed)) return { config: {}, error: `${path}: top level must be an object` };
		return { config: parsed };
	} catch (err) {
		return { config: {}, error: `${path}: ${(err as Error).message}` };
	}
}

function stringList(value: Json | undefined): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** The merged config. Pass `user` to skip reading the file (tests). */
export function loadConfig(user: ConfigObject = readUserConfig().config): BoehslineConfig {
	let merged: ConfigObject = {};
	for (const config of sources().values()) {
		const { enable: _ignored, ...settings } = config;
		merged = merge(merged, settings);
	}
	merged = merge(merged, user);
	return { ...merged, enable: [...new Set([...stringList(user.enable), ...envEnable()])] };
}

function envEnable(env: NodeJS.ProcessEnv = process.env): string[] {
	return (env.BOEHSLINE_ENABLE ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function enabled(name: string, config: BoehslineConfig = loadConfig()): boolean {
	return config.enable.includes(name);
}

/** One extension's settings block, merged over the extension's own defaults. */
export function settingsFor<T extends ConfigObject>(name: string, defaults: T, config: BoehslineConfig = loadConfig()): T {
	const block = config[name];
	return (isPlainObject(block) ? merge(defaults, block) : { ...defaults }) as T;
}

/** Add or remove a name from the user file's `enable` list. Writes atomically; keeps other keys. */
export function setEnabled(name: string, on: boolean, path = userConfigPath()): string[] {
	const { config, error } = readUserConfig(path);
	if (error) throw new Error(`refusing to rewrite a broken config: ${error}`);
	const list = new Set(stringList(config.enable));
	if (on) list.add(name);
	else list.delete(name);
	const next: ConfigObject = { ...config, enable: [...list].sort() };
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
	renameSync(tmp, path);
	return next.enable as string[];
}

/** Opt-in extensions that have loaded their gate this process, and whether each is on. */
export interface OptInRecord {
	name: string;
	description: string;
	on: boolean;
}

export function optIns(): Map<string, OptInRecord> {
	const g = globalThis as unknown as Record<symbol, Map<string, OptInRecord> | undefined>;
	return (g[OPT_INS_KEY] ??= new Map());
}
