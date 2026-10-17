/**
 * image-prune's pure logic: measure the images in the model-visible context,
 * decide whether to prune, pick the entries, and build replacement content.
 *
 * Everything here works on pi's session projection (`ProjectedSessionEntry[]`
 * from `buildSessionProjection()` or a boundary event's `context.contextEntries`),
 * so it sees exactly what the next request sends: entries before the latest
 * compaction's kept boundary aren't in it, and earlier context edits are
 * already applied. No pi runtime imports and no I/O, so tests run under plain
 * `node --test`.
 */

import type { ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";

export interface ImageBlock {
	type: "image";
	data: string;
	mimeType: string;
}

export interface TextBlock {
	type: "text";
	text: string;
}

export interface Settings {
	[key: string]: boolean | number;
	enabled: boolean;
	thresholdMB: number;
	keepTurns: number;
}

export const DEFAULTS: Settings = { enabled: true, thresholdMB: 5, keepTurns: 2 };

const MB = 1024 * 1024;

/** Number settings that came from JSON: anything not a finite, non-negative number falls back. */
export function normalize(raw: Partial<Record<string, unknown>>): Settings {
	const num = (value: unknown, fallback: number) =>
		typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
	return {
		enabled: raw.enabled !== false,
		thresholdMB: num(raw.thresholdMB, DEFAULTS.thresholdMB),
		keepTurns: Math.floor(num(raw.keepTurns, DEFAULTS.keepTurns)),
	};
}

export function isImage(block: unknown): block is ImageBlock {
	const b = block as { type?: unknown; data?: unknown } | null;
	return !!b && b.type === "image" && typeof b.data === "string";
}

/** The image blocks in a message's content (string content has none). */
export function imagesIn(content: unknown): ImageBlock[] {
	return Array.isArray(content) ? content.filter(isImage) : [];
}

/** What the images cost on the wire: base64 characters, one byte each. */
export const base64Bytes = (images: ImageBlock[]): number => images.reduce((n, img) => n + img.data.length, 0);

/** Decoded size of one image, for the note. */
export function decodedBytes(img: ImageBlock): number {
	const pad = img.data.endsWith("==") ? 2 : img.data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((img.data.length * 3) / 4) - pad);
}

interface Message {
	role: string;
	content?: unknown;
	toolCallId?: string;
	toolName?: string;
}

/** Entry kinds pi's appendContextEdit accepts as targets. */
function editable(entry: ProjectedSessionEntry["sourceEntry"]): boolean {
	if (entry.type === "custom_message") return true;
	if (entry.type !== "message") return false;
	const role = entry.message.role;
	return role === "user" || role === "assistant" || role === "toolResult";
}

export interface ImageEntry {
	/** The source entry's id: the context_edit target. */
	entryId: string;
	/** Position in the projection. */
	index: number;
	role: string;
	/** The entry's projected message (content after earlier edits). */
	message: Message;
	images: ImageBlock[];
	bytes: number;
	/** Older than the last keepTurns user turns. */
	prunable: boolean;
}

export interface Scan {
	/** Base64 bytes of every image in the visible context. */
	totalBytes: number;
	count: number;
	/** Of those, the ones older than the last keepTurns user turns. */
	prunableBytes: number;
	prunableCount: number;
	entries: ImageEntry[];
	/** Projection index of the first kept user turn; entries before it are prunable. */
	cutoff: number;
}

/**
 * Projection index where the last `keepTurns` user turns begin. A user turn
 * starts at a user message; everything before the keepTurns-th one from the
 * end is older. Fewer user turns than that keeps everything (cutoff 0).
 */
export function turnCutoff(entries: ProjectedSessionEntry[], keepTurns: number): number {
	if (keepTurns <= 0) return entries.length;
	let seen = 0;
	for (let i = entries.length - 1; i >= 0; i--) {
		const messages = (entries[i]?.messages ?? []) as Message[];
		if (messages.some((m) => m.role === "user")) {
			seen++;
			if (seen === keepTurns) return i;
		}
	}
	return 0;
}

/** Measure the images in a projection and mark which are prunable. */
export function scan(entries: ProjectedSessionEntry[], keepTurns: number): Scan {
	const cutoff = turnCutoff(entries, keepTurns);
	const found: ImageEntry[] = [];
	let totalBytes = 0;
	let count = 0;
	entries.forEach((projected, index) => {
		for (const message of projected.messages as Message[]) {
			const images = imagesIn(message.content);
			if (!images.length) continue;
			const bytes = base64Bytes(images);
			totalBytes += bytes;
			count += images.length;
			// One message per editable entry; anything else (a compaction's
			// system checkpoint) is counted but never targeted.
			if (!editable(projected.sourceEntry) || projected.messages.length !== 1) continue;
			found.push({
				entryId: projected.sourceEntry.id,
				index,
				role: message.role,
				message,
				images,
				bytes,
				prunable: index < cutoff,
			});
		}
	});
	const prunable = found.filter((e) => e.prunable);
	return {
		totalBytes,
		count,
		prunableBytes: prunable.reduce((n, e) => n + e.bytes, 0),
		prunableCount: prunable.reduce((n, e) => n + e.images.length, 0),
		entries: found,
		cutoff,
	};
}

export interface Plan {
	fire: boolean;
	reason: string;
	targets: ImageEntry[];
	scan: Scan;
}

/**
 * Whether to prune now, and what. Fires only when the visible images exceed
 * the threshold, and then takes every prunable entry in one batch: each edit
 * to earlier context busts the prompt cache from that point on, so pruning a
 * little every turn would cost far more than it saves.
 *
 * It also waits until the prunable images are at least a quarter of the
 * threshold. When the recent turns alone are over the threshold, each new
 * user turn ages a few images past the cutoff; without the floor every turn
 * would edit a little, which is exactly the churn batching avoids. `force`
 * (`/image-prune now`) skips both checks.
 */
export function plan(entries: ProjectedSessionEntry[], settings: Settings, force = false): Plan {
	const s = scan(entries, settings.keepTurns);
	const targets = s.entries.filter((e) => e.prunable);
	const threshold = settings.thresholdMB * MB;
	const no = (reason: string): Plan => ({ fire: false, reason, targets: [], scan: s });
	if (!targets.length) return no(s.count ? `no images older than the last ${settings.keepTurns} user turns` : "no images in context");
	if (!force) {
		if (!settings.enabled) return no("disabled in settings");
		if (s.totalBytes <= threshold) return no(`${formatBytes(s.totalBytes)} is under the ${settings.thresholdMB} MB threshold`);
		if (s.prunableBytes < threshold / 4) {
			return no(`only ${formatBytes(s.prunableBytes)} is older than the last ${settings.keepTurns} user turns; waiting for more`);
		}
	}
	return { fire: true, reason: force ? "forced" : "over threshold", targets, scan: s };
}

/** Map toolCallId → file path, from the assistant tool calls in the projection. */
export function toolCallPaths(entries: ProjectedSessionEntry[]): Map<string, string> {
	const paths = new Map<string, string>();
	for (const projected of entries) {
		for (const message of projected.messages as Message[]) {
			if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
			for (const block of message.content as { type?: string; id?: string; arguments?: Record<string, unknown> }[]) {
				if (block?.type !== "toolCall" || !block.id) continue;
				const args = block.arguments ?? {};
				const path = [args.path, args.file_path, args.filePath].find((p) => typeof p === "string" && p);
				if (typeof path === "string") paths.set(block.id, path);
			}
		}
	}
	return paths;
}

export function formatBytes(bytes: number): string {
	if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
	return `${Math.round(bytes / 1024)} KB`;
}

export function extensionFor(mimeType: string): string {
	const sub = mimeType.toLowerCase().split("/")[1]?.split(/[+;]/)[0] ?? "";
	if (sub === "jpeg") return "jpg";
	return /^[a-z0-9]+$/.test(sub) ? sub : "bin";
}

/** The text that stands in for a removed image. */
export function note(img: ImageBlock, path: string | undefined): string {
	const kb = Math.max(1, Math.round(decodedBytes(img) / 1024));
	const where = path ?? "pasted image";
	const hint = path ? "Use the read tool on the path to view it again." : "It wasn't saved, so it can't be viewed again.";
	return `[image removed to save context: ${where}, ${img.mimeType}, ~${kb} KB. ${hint}]`;
}

/**
 * The message content with each image replaced by its note; text and other
 * blocks stay as they are, in order. `pathFor` gives a re-readable path for
 * each image (or undefined when none could be had).
 */
export function replaceImages(content: unknown[], pathFor: (img: ImageBlock, n: number) => string | undefined): unknown[] {
	let n = 0;
	return content.map((block) => (isImage(block) ? ({ type: "text", text: note(block, pathFor(block, n++)) } satisfies TextBlock) : block));
}
