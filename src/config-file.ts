import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type GuardianConfigObject = Record<string, unknown>;

/**
 * Read a Guardian config file as a raw JSON object so edits preserve keys the
 * settings menu does not manage. Throws when the file exists but is not a JSON
 * object: the menu must never overwrite a file it cannot round-trip.
 */
export function readGuardianConfigObject(path: string): GuardianConfigObject {
	if (!existsSync(path)) return {};
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${path} is not a JSON object.`);
	}
	return parsed as GuardianConfigObject;
}

/** Apply a mutation to a Guardian config file and write it atomically. */
export function updateGuardianConfigFile(
	path: string,
	mutate: (config: GuardianConfigObject) => void,
): GuardianConfigObject {
	const config = readGuardianConfigObject(path);
	mutate(config);
	if (
		config.review &&
		typeof config.review === "object" &&
		!Array.isArray(config.review) &&
		Object.keys(config.review).length === 0
	) {
		delete config.review;
	}
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
		mode: 0o600,
	});
	renameSync(temporaryPath, path);
	return config;
}

/** Set a top-level key, or remove it when value is undefined. */
export function setConfigValue(
	config: GuardianConfigObject,
	key: string,
	value: unknown,
): void {
	if (value === undefined) delete config[key];
	else config[key] = value;
}

/** Set a review rule, or remove it when level is undefined. */
export function setReviewRule(
	config: GuardianConfigObject,
	key: string,
	level: string | undefined,
): void {
	const current =
		config.review &&
		typeof config.review === "object" &&
		!Array.isArray(config.review)
			? { ...(config.review as Record<string, unknown>) }
			: {};
	if (level === undefined) delete current[key];
	else current[key] = level;
	config.review = current;
}
