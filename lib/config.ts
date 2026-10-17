/**
 * Boehsline configuration: which opt-in extensions are on, and per-extension
 * settings.
 *
 * Layers, lowest to highest precedence:
 *   1. Defaults written in each extension's code (neutral, nothing personal).
 *   2. Config sources: other packages, such as a private work companion,
 *      that register settings through the global registry below.
 *   3. The user file: $BOEHSLINE_CONFIG, else boehsline.json in pi's agent
 *      folder ($PI_CODING_AGENT_DIR, default ~/.pi/agent).
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
 *   ((globalThis as any)[key] ??= new Map()).set("my-work-settings", { watch: { … } });
 *
 * Pure node: no pi imports, so tests run under plain `node --test`.
 */

import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
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
	return env.BOEHSLINE_CONFIG || join(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "boehsline.json");
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

/**
 * JSON with comments: `//` and `/* *\/` comments and trailing commas are
 * dropped (outside strings) before JSON.parse, so a pasted README example
 * works. Throws like JSON.parse on anything else.
 */
export function parseJsonc(text: string): unknown {
	return JSON.parse(stripJsonc(text));
}

/** The text without comments or trailing commas; strings are kept byte for byte. */
export function stripJsonc(text: string): string {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			let j = i + 1;
			while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j;
		} else if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			out += "\n";
		} else if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end === -1 ? text.length : end + 1;
			out += " ";
		} else {
			out += c;
		}
	}
	// Trailing commas: a comma followed only by whitespace before } or ],
	// unless it sits inside a string ("a,}").
	return out.replace(/,(\s*[}\]])/g, (match, tail, offset) => (insideString(out, offset) ? match : tail));
}

/** Whether `offset` in comment-free JSON text falls inside a string literal. */
function insideString(text: string, offset: number): boolean {
	let inside = false;
	for (let i = 0; i < offset; i++) {
		if (text[i] === "\\" && inside) i++;
		else if (text[i] === '"') inside = !inside;
	}
	return inside;
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
		const parsed: unknown = parseJsonc(text);
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
	let text = `${JSON.stringify(next, null, 2)}\n`;
	let original = "";
	try {
		original = readFileSync(path, "utf8");
	} catch {
		// new file
	}
	// A file with comments: change only the enable list in place, so the
	// comments survive. Plain JSON is rewritten whole, as before.
	if (original && stripJsonc(original) !== original) text = replaceEnable(original, next.enable as string[]);
	// Write through a symlink (dotfiles often link boehsline.json); renaming
	// over the link itself would replace it with a plain file.
	let target = path;
	try {
		target = realpathSync(path);
	} catch {
		// new file
	}
	mkdirSync(dirname(target), { recursive: true });
	const tmp = `${target}.tmp-${process.pid}`;
	writeFileSync(tmp, text);
	renameSync(tmp, target);
	return next.enable as string[];
}

/**
 * The file's text with its top-level "enable" array replaced (or added after
 * the opening brace), comments untouched. Checked by parsing the result; if
 * that doesn't give exactly the new list, it refuses rather than guess.
 */
function replaceEnable(original: string, enable: string[]): string {
	const array = JSON.stringify(enable);
	const stripped = stripJsonc(original);
	const pattern = /"enable"\s*:\s*\[[^\]]*\]/g;
	let text: string;
	// Only edit when the stripped text has exactly one "enable" array, and
	// the raw text has the same one (so the match isn't inside a comment).
	const matches = stripped.match(pattern) ?? [];
	const rawMatches = original.match(pattern) ?? [];
	if (matches.length === 1 && rawMatches.length === 1) text = original.replace(pattern, `"enable": ${array}`);
	else if (matches.length === 0) text = original.replace(/\{/, `{\n  "enable": ${array},`);
	else throw new Error("can't update enable in a file with comments and more than one enable list; edit it by hand");
	let result: unknown;
	try {
		result = parseJsonc(text);
	} catch {
		result = undefined;
	}
	const got = isPlainObject(result) ? stringList(result.enable as Json | undefined) : undefined;
	if (!got || got.join() !== enable.join()) throw new Error("couldn't update enable without losing the file's comments; edit it by hand");
	return text.endsWith("\n") ? text : `${text}\n`;
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
