/**
 * Lean shared task store for the pi `todo` extension. Pure Node (no pi imports)
 * so it is unit-testable with `node --test`.
 *
 * Storage is a plain markdown checklist (default `.pi/TODO.md`). Only item lines
 * are parsed; every other line (headings, notes, blanks) round-trips verbatim,
 * and untouched item lines are written back byte-for-byte.
 *
 *   - [ ] #1 Open task
 *   - [/] #2 Claimed / in-progress task [@pi-a1b2]
 *   - [x] #3 Done task [@eric]
 *   - [!] #4 Blocked task [@eric] [blocked: waiting on API]
 *   - [-] #5 Dropped task
 *
 * Concurrency model lifted from @minhduydev/pi-todo's TodoStore (minus the
 * proper-lockfile dependency):
 *  - in-process mutex: every mutation runs on one promise chain
 *  - inter-process lock: exclusive-create `<file>.lock` held across
 *    read → mutate → rename, so a claim is a true compare-and-set across sessions
 *  - CAS against external writers (editors, bash): content hash before read and
 *    before rename; re-read + re-apply on change, bounded, then throw
 *  - durable atomic write: unique temp file, fsync, rename, fsync directory
 *  - fs.watch on the directory (basename-filtered, debounced) for outside edits
 */
import { createHash, randomUUID } from "node:crypto";
import { type FSWatcher, readFileSync, statSync, watch } from "node:fs";
import { link, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname } from "node:path";

/* --------------------------------- model ---------------------------------- */

export type Status = "open" | "active" | "done" | "blocked" | "dropped";

export const MARK: Record<Status, string> = { open: " ", active: "/", done: "x", blocked: "!", dropped: "-" };
const STATUS: Record<string, Status> = { " ": "open", "/": "active", x: "done", X: "done", "!": "blocked", "-": "dropped" };

export interface Item {
	id?: number;
	status: Status;
	text: string;
	owner?: string;
	note?: string;
	indent: string;
	bullet: string;
	/** Original line; dropped on any change so untouched lines round-trip exactly. */
	raw?: string;
}

export type Line = { item: Item } | { raw: string };
export type Doc = Line[];

export class TodoError extends Error {}

const ITEM_RE = /^(\s*)([-*]) \[([ xX/!-])\](?: (.*))?$/;
const TAG_RE = /\s*\[(@[\w.-]+|blocked:[^\]]*)\]$/;
export const NAME_RE = /^[\w.-]+$/;

const HEADER = [
	"# Tasks",
	"",
	"<!-- Shared by you and pi agents. [ ] open  [/] claimed  [x] done  [!] blocked  [-] dropped  ·  owner: [@name] -->",
	"",
];

export function parse(md: string): Doc {
	if (md === "") return [];
	return md.split("\n").map((raw): Line => {
		const m = ITEM_RE.exec(raw);
		if (!m) return { raw };
		// The groups always match when ITEM_RE does.
		const item: Item = { status: STATUS[m[3]!]!, text: "", indent: m[1]!, bullet: m[2]!, raw };
		let rest = (m[4] ?? "").trim();
		const idm = /^#(\d+)(?:\s+|$)/.exec(rest);
		if (idm) {
			item.id = Number(idm[1]);
			rest = rest.slice(idm[0].length);
		}
		for (let t = TAG_RE.exec(rest); t; t = TAG_RE.exec(rest)) {
			const tag = t[1]!;
			if (tag.startsWith("@")) item.owner ??= tag.slice(1);
			else item.note ??= tag.slice("blocked:".length).trim();
			rest = rest.slice(0, t.index);
		}
		item.text = rest.trim();
		return { item };
	});
}

export function formatLine(it: Item): string {
	const id = it.id !== undefined ? `#${it.id} ` : "";
	const owner = it.owner ? ` [@${it.owner}]` : "";
	const note = it.status === "blocked" && it.note ? ` [blocked: ${it.note}]` : "";
	return `${it.indent}${it.bullet} [${MARK[it.status]}] ${id}${it.text}${owner}${note}`;
}

export function serialize(doc: Doc): string {
	return doc.map((l) => ("item" in l ? (l.item.raw ?? formatLine(l.item)) : l.raw)).join("\n");
}

export function items(doc: Doc): Item[] {
	return doc.flatMap((l) => ("item" in l ? [l.item] : []));
}

export const isOpen = (i: Item) => i.status === "open" || i.status === "active" || i.status === "blocked";

/** Human/agent-facing one-liner for a task. */
export function fmt(it: Item, me?: string): string {
	const owner = it.owner ? ` @${it.owner}${it.owner === me ? " (you)" : ""}` : "";
	const note = it.status === "blocked" && it.note ? ` — blocked: ${it.note}` : "";
	return `#${it.id ?? "?"} [${MARK[it.status]}] ${it.text}${owner}${note}`;
}

/** Give every item a unique id (human-added lines have none; copy-paste dupes). */
export function ensureIds(doc: Doc): Doc {
	const seen = new Set<number>();
	let next = maxId(doc) + 1;
	return doc.map((l) => {
		if (!("item" in l)) return l;
		const { id } = l.item;
		if (id !== undefined && !seen.has(id)) {
			seen.add(id);
			return l;
		}
		return { item: { ...l.item, id: next++, raw: undefined } };
	});
}

function maxId(doc: Doc): number {
	return items(doc).reduce((m, i) => Math.max(m, i.id ?? 0), 0);
}

/* ---------------------------------- ops ----------------------------------- */

export type Op = "add" | "claim" | "release" | "done" | "block" | "drop" | "edit" | "assign" | "rm" | "clear";

export interface OpArgs {
	who: string;
	id?: number;
	text?: string;
	force?: boolean;
}

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\]/g, ")").trim();

function locate(doc: Doc, id: number | undefined): number {
	if (id === undefined || !Number.isInteger(id)) throw new TodoError("A task id is required.");
	const i = doc.findIndex((l) => "item" in l && l.item.id === id);
	if (i < 0) throw new TodoError(`No task #${id}.`);
	return i;
}

/** Tasks owned by someone else are locked until done/dropped, unless forced. */
function guard(it: Item, who: string, force?: boolean) {
	if (!force && it.owner && it.owner !== who && isOpen(it)) {
		throw new TodoError(`#${it.id} is claimed by @${it.owner}. Pick another task (force overrides).`);
	}
}

function insertItem(doc: Doc, item: Item): Doc {
	const d: Doc = doc.length ? [...doc] : [...HEADER.map((raw) => ({ raw })), { raw: "" }];
	let idx = -1;
	d.forEach((l, i) => {
		if ("item" in l) idx = i;
	});
	if (idx >= 0) idx += 1;
	else {
		const last = d[d.length - 1];
		idx = last && "raw" in last && last.raw === "" ? d.length - 1 : d.length;
	}
	d.splice(idx, 0, { item });
	return d;
}

/** Pure: returns the next doc + a result message. Throws TodoError on refusal. */
export function applyOp(doc: Doc, op: Op, a: OpArgs): { doc: Doc; result: string } {
	if (op === "add") {
		const text = clean(a.text ?? "");
		if (!text) throw new TodoError("Task text is required.");
		const item: Item = { id: maxId(doc) + 1, status: "open", text, indent: "", bullet: "-" };
		return { doc: insertItem(doc, item), result: `Added #${item.id}: ${text}` };
	}
	if (op === "clear") {
		const next = doc.filter((l) => !("item" in l) || isOpen(l.item));
		return { doc: next, result: `Cleared ${doc.length - next.length} done/dropped task(s).` };
	}

	const idx = locate(doc, a.id);
	const it = (doc[idx] as { item: Item }).item;
	const set = (patch: Partial<Item>, result: string) => {
		const next = [...doc];
		next[idx] = { item: { ...it, ...patch, raw: undefined } };
		return { doc: next, result };
	};

	switch (op) {
		case "claim": {
			guard(it, a.who, a.force);
			if (!isOpen(it) && !a.force) throw new TodoError(`#${it.id} is already ${it.status}.`);
			const took = it.owner && it.owner !== a.who ? ` (took over from @${it.owner})` : "";
			return set({ status: "active", owner: a.who, note: undefined }, `Claimed #${it.id} as @${a.who}${took}: ${it.text}`);
		}
		case "release":
			guard(it, a.who, a.force);
			return set(
				{ owner: undefined, status: it.status === "active" ? "open" : it.status },
				`Released #${it.id}: ${it.text}`,
			);
		case "done":
			guard(it, a.who, a.force);
			return set({ status: "done", owner: it.owner ?? a.who, note: undefined }, `Done #${it.id}: ${it.text}`);
		case "block":
			guard(it, a.who, a.force);
			return set(
				{ status: "blocked", note: a.text ? clean(a.text) : it.note },
				`Blocked #${it.id}${a.text ? `: ${clean(a.text)}` : ""}`,
			);
		case "drop":
			guard(it, a.who, a.force);
			return set({ status: "dropped", note: undefined }, `Dropped #${it.id}: ${it.text}`);
		case "edit": {
			guard(it, a.who, a.force);
			const text = clean(a.text ?? "");
			if (!text) throw new TodoError("New text is required.");
			return set({ text }, `Edited #${it.id}: ${text}`);
		}
		case "assign": {
			const name = a.text?.trim().replace(/^@/, "");
			if (!name || name === "-") return set({ owner: undefined }, `Unassigned #${it.id}`);
			if (!NAME_RE.test(name)) throw new TodoError(`Invalid owner name: ${name}`);
			return set({ owner: name }, `Assigned #${it.id} to @${name}`);
		}
		case "rm": {
			const next = [...doc];
			next.splice(idx, 1);
			return { doc: next, result: `Removed #${it.id}: ${it.text}` };
		}
		default:
			throw new TodoError(`Unknown op: ${op}`);
	}
}

/* --------------------------------- store ---------------------------------- */

const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 3_000;
const CAS_ATTEMPTS = 5;

const errCode = (e: unknown) => (e as { code?: string } | null)?.code;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TodoStore {
	readonly path: string;
	private cache: Doc = [];
	private chain: Promise<unknown> = Promise.resolve();
	private watcher: FSWatcher | null = null;
	private debounce: ReturnType<typeof setTimeout> | null = null;
	private onChange?: (doc: Doc) => void;

	constructor(path: string, onChange?: (doc: Doc) => void) {
		this.path = path;
		this.onChange = onChange;
		try {
			this.cache = this.readSync();
		} catch {
			this.cache = [];
		}
	}

	get(): Doc {
		return this.cache;
	}

	items(): Item[] {
		return items(this.cache);
	}

	/** Fresh read for listing; assigns ids to hand-added lines (a locked write) if needed. */
	async list(): Promise<Doc> {
		const doc = this.refresh();
		const ids = items(doc).map((i) => i.id);
		if (ids.every((id) => id !== undefined) && new Set(ids).size === ids.length) return doc;
		await this.apply((d) => ({ doc: d, result: undefined }));
		return this.cache;
	}

	/** Re-read from disk (watch handler). Keeps the cache on transient errors. */
	refresh(): Doc {
		try {
			this.setCache(this.readSync());
		} catch {
			// transient unreadable state — keep cache
		}
		return this.cache;
	}

	/**
	 * Apply a pure transformation under the in-process mutex + inter-process lock,
	 * CAS-checked against external writers, then write atomically. `fn` may run
	 * more than once (CAS retry), so it must be pure.
	 */
	apply<T>(fn: (doc: Doc) => { doc: Doc; result: T }): Promise<T> {
		return this.enqueue(() =>
			this.withLock(async () => {
				for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
					const vBefore = this.hash();
					const before = this.readSync();
					const { doc, result } = fn(before);
					const next = ensureIds(doc);
					const text = serialize(next);
					if (text === serialize(before)) {
						this.setCache(before);
						return result;
					}
					if (this.hash() !== vBefore) continue; // someone edited mid-flight: re-read
					await durableReplace(this.path, text);
					this.setCache(next);
					this.startWatch(); // the directory may have just been created
					return result;
				}
				throw new Error(`${basename(this.path)} kept changing during write; try again.`);
			}),
		);
	}

	startWatch(): void {
		if (this.watcher) return;
		const base = basename(this.path);
		try {
			this.watcher = watch(dirname(this.path), (_event, file) => {
				if (file && file !== base) return; // ignore lock/temp/sibling files
				if (this.debounce) clearTimeout(this.debounce);
				this.debounce = setTimeout(() => this.refresh(), 100);
				this.debounce.unref?.();
			});
			this.watcher.on("error", () => this.stop());
			this.watcher.unref();
		} catch {
			// directory doesn't exist yet; the first write calls startWatch again
		}
	}

	stop(): void {
		if (this.debounce) clearTimeout(this.debounce);
		this.debounce = null;
		this.watcher?.close();
		this.watcher = null;
	}

	private setCache(doc: Doc) {
		if (serialize(doc) === serialize(this.cache)) return;
		this.cache = doc;
		this.onChange?.(doc);
	}

	/** ENOENT → empty doc; any other error throws so we never clobber real content. */
	private readSync(): Doc {
		let st: ReturnType<typeof statSync>;
		try {
			st = statSync(this.path);
		} catch (e) {
			if (errCode(e) === "ENOENT") return [];
			throw e;
		}
		if (!st.isFile()) throw new Error(`${this.path} is not a regular file`);
		return parse(readFileSync(this.path, "utf8"));
	}

	private hash(): string {
		try {
			return createHash("sha256").update(readFileSync(this.path)).digest("hex");
		} catch (e) {
			return errCode(e) === "ENOENT" ? "missing" : `err:${errCode(e)}`;
		}
	}

	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.chain.then(task, task);
		this.chain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	private async withLock<T>(fn: () => Promise<T>): Promise<T> {
		const lockPath = `${this.path}.lock`;
		const token = await acquireLock(lockPath);
		try {
			return await fn();
		} finally {
			await releaseLock(lockPath, token);
		}
	}
}

/* ---------------------------------- lock ---------------------------------- */

interface LockInfo {
	pid: number;
	token: string;
}

function parseLock(raw: string): LockInfo | undefined {
	try {
		const v = JSON.parse(raw);
		return typeof v?.pid === "number" && typeof v?.token === "string" ? v : undefined;
	} catch {
		return undefined;
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return errCode(e) === "EPERM";
	}
}

export async function acquireLock(lockPath: string): Promise<string> {
	await mkdir(dirname(lockPath), { recursive: true });
	const token = randomUUID();
	const body = JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() });
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			const h = await open(lockPath, "wx");
			try {
				await h.writeFile(body, "utf8");
			} finally {
				await h.close();
			}
			return token;
		} catch (e) {
			if (errCode(e) !== "EEXIST") throw e;
		}
		if (await breakIfStale(lockPath)) continue;
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lockPath}`);
		await sleep(LOCK_RETRY_MS + Math.random() * LOCK_RETRY_MS);
	}
}

/** Remove a lock left by a dead process (or older than LOCK_STALE_MS). */
async function breakIfStale(lockPath: string): Promise<boolean> {
	let raw: string;
	let mtimeMs: number;
	try {
		mtimeMs = (await stat(lockPath)).mtimeMs;
		raw = await readFile(lockPath, "utf8");
	} catch (e) {
		if (errCode(e) === "ENOENT") return true; // released meanwhile: retry now
		throw e;
	}
	const info = parseLock(raw);
	const stale = Date.now() - mtimeMs > LOCK_STALE_MS || (info !== undefined && !pidAlive(info.pid));
	if (!stale) return false;
	const grave = `${lockPath}.stale-${randomUUID()}`;
	try {
		await rename(lockPath, grave);
	} catch (e) {
		if (errCode(e) === "ENOENT") return true;
		throw e;
	}
	// Steal race: if what we moved isn't the lock we judged stale, put it back
	// (link fails if a new lock already exists, which is also fine).
	const moved = await readFile(grave, "utf8").catch(() => "");
	if (moved !== raw) await link(grave, lockPath).catch(() => undefined);
	await unlink(grave).catch(() => undefined);
	return true;
}

export async function releaseLock(lockPath: string, token: string): Promise<void> {
	try {
		if (parseLock(await readFile(lockPath, "utf8"))?.token === token) await unlink(lockPath);
	} catch {
		// already gone
	}
}

/* ------------------------------ atomic write ------------------------------ */

async function durableReplace(target: string, contents: string): Promise<void> {
	const dir = dirname(target);
	await mkdir(dir, { recursive: true });
	const tmp = `${target}.tmp-${randomUUID()}`;
	let renamed = false;
	try {
		const h = await open(tmp, "wx", 0o666);
		try {
			await h.writeFile(contents, "utf8");
			await h.sync();
		} finally {
			await h.close();
		}
		await rename(tmp, target);
		renamed = true;
		await syncDir(dir);
	} finally {
		if (!renamed) await unlink(tmp).catch(() => undefined);
	}
}

async function syncDir(dir: string): Promise<void> {
	let h: Awaited<ReturnType<typeof open>> | undefined;
	try {
		h = await open(dir, "r");
		await h.sync();
	} catch (e) {
		const c = errCode(e);
		if (c !== "EINVAL" && c !== "ENOTSUP" && c !== "EISDIR" && c !== "EPERM") throw e;
	} finally {
		await h?.close().catch(() => undefined);
	}
}
