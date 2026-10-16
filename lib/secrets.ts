/**
 * Secrets for Boehsline extensions: the environment first, then a configurable
 * secret command.
 *
 *   "secrets": { "command": ["fnox", "get"] }                         (default)
 *   "secrets": { "command": ["op", "read", "op://Private/{name}/credential"] }
 *   "secrets": { "command": [] }                                       (env only)
 *
 * `{name}` in any argument is replaced with the variable name; without one, the
 * name is appended. The command's stdout (trimmed) is the value. A missing
 * command, a non-zero exit or empty output all mean "no value": callers treat
 * a missing secret as "feature off" and never fail because of one.
 *
 * Values are never logged, cached on disk, or included in errors.
 */

import { spawn } from "node:child_process";
import { settingsFor } from "./config.ts";

export interface SecretSettings {
	[key: string]: string[] | number;
	command: string[];
	timeoutMs: number;
}

export const SECRET_DEFAULTS: SecretSettings = { command: ["fnox", "get"], timeoutMs: 10_000 };

export function secretSettings(): SecretSettings {
	const s = settingsFor("secrets", SECRET_DEFAULTS);
	const raw = s.command as unknown;
	const command = Array.isArray(raw)
		? raw.filter((a): a is string => typeof a === "string")
		: typeof raw === "string"
			? raw.split(/\s+/).filter(Boolean)
			: [];
	const timeoutMs = typeof s.timeoutMs === "number" && s.timeoutMs > 0 ? s.timeoutMs : SECRET_DEFAULTS.timeoutMs;
	return { command, timeoutMs };
}

/** The argv for one secret, or null when no command is configured. */
export function secretArgv(name: string, command: readonly string[] = secretSettings().command): string[] | null {
	if (!command.length) return null;
	const hasSlot = command.some((a) => a.includes("{name}"));
	const argv = command.map((a) => a.replaceAll("{name}", name));
	return hasSlot ? argv : [...argv, name];
}

/** What error messages call the fallback: "fnox", "op", or "env only". */
export function secretSourceLabel(command: readonly string[] = secretSettings().command): string {
	return command[0] ? (command[0].split("/").at(-1) ?? command[0]) : "env only";
}

/** Run the secret command for `name`. Never throws. */
export function readSecret(name: string, settings: SecretSettings = secretSettings()): Promise<string | undefined> {
	const argv = secretArgv(name, settings.command);
	if (!argv) return Promise.resolve(undefined);
	const [cmd, ...args] = argv as [string, ...string[]];
	return new Promise((resolve) => {
		let out = "";
		let done = false;
		const finish = (v: string | undefined) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(v);
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
			timer = setTimeout(() => {
				p.kill();
				finish(undefined);
			}, settings.timeoutMs);
			timer.unref?.();
			p.stdout.on("data", (d) => (out += d));
			p.on("error", () => finish(undefined));
			p.on("close", (code) => finish(code === 0 && out.trim() ? out.trim() : undefined));
		} catch {
			finish(undefined);
		}
	});
}

/** The environment variable if set, else the secret command. */
export async function envOrSecret(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
	return env[name]?.trim() || (await readSecret(name));
}
