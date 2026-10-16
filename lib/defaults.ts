/**
 * Boehsline's opinionated defaults (defaults/keybindings.json), merged into the
 * user's files by `/boehsline defaults`.
 *
 * Merging only fills keys the user hasn't set. With `force`, a default also
 * replaces a different value the user chose. Nothing is ever removed. Pure:
 * reading and writing files is the caller's job.
 */

import { readFileSync } from "node:fs";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Flat = Record<string, Json>;

export interface DefaultsPlan {
	/** Keys the user doesn't have: added. */
	add: [string, Json][];
	/** Keys the user set differently: replaced only with force, else kept. */
	change: [string, Json, Json][];
	/** The merged file, as it would be written. */
	merged: Flat;
}

const same = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

export function planDefaults(user: Flat, defaults: Flat, force = false): DefaultsPlan {
	const add: [string, Json][] = [];
	const change: [string, Json, Json][] = [];
	const merged: Flat = { ...user };
	for (const [key, value] of Object.entries(defaults)) {
		if (key.startsWith("//")) continue;
		if (!(key in user)) {
			add.push([key, value]);
			merged[key] = value;
		} else if (!same(user[key] as Json, value)) {
			change.push([key, user[key] as Json, value]);
			if (force) merged[key] = value;
		}
	}
	return { add, change, merged };
}

const show = (v: Json) => JSON.stringify(v);

/** The diff a person reads before confirming. */
export function diffText(plan: DefaultsPlan, force: boolean): string {
	const lines: string[] = [];
	for (const [k, v] of plan.add) lines.push(`+ ${k}: ${show(v)}`);
	for (const [k, mine, theirs] of plan.change) {
		lines.push(force ? `~ ${k}: ${show(mine)} → ${show(theirs)}` : `= ${k}: keeping ${show(mine)} (default ${show(theirs)}; --force replaces)`);
	}
	return lines.join("\n");
}

/** Whether the plan writes anything. */
export const changes = (plan: DefaultsPlan, force: boolean) => plan.add.length > 0 || (force && plan.change.length > 0);

/** Read a JSON object file; missing is {}, anything else broken throws. */
export function readFlat(path: string): Flat {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return {};
	}
	const parsed: unknown = JSON.parse(text);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${path}: top level must be an object`);
	return parsed as Flat;
}

/**
 * pi actions Boehsline's extensions take the default keys of: stash binds
 * Ctrl+S (pi: app.models.save, app.thinking.save, app.session.toggleSort) and
 * prompt-history Ctrl+R (pi: app.session.rename).
 * Unset in the user's keybindings means pi still claims those keys.
 */
export const SHORTCUT_CONFLICTS: { action: string; key: string; by: string }[] = [
	{ action: "app.models.save", key: "Ctrl+S", by: "stash" },
	{ action: "app.thinking.save", key: "Ctrl+S", by: "stash" },
	{ action: "app.session.toggleSort", key: "Ctrl+S", by: "stash" },
	{ action: "app.session.rename", key: "Ctrl+R", by: "prompt-history" },
];

/** Conflicts still open, one per key: [{ key: "Ctrl+S", by: "stash" }, …]. */
export function unresolvedConflicts(userKeybindings: Flat): { key: string; by: string }[] {
	const open = new Map<string, string>();
	for (const c of SHORTCUT_CONFLICTS) if (!(c.action in userKeybindings)) open.set(c.key, c.by);
	return [...open].map(([key, by]) => ({ key, by }));
}
