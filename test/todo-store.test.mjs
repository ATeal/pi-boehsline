import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyOp, items, parse, serialize, TodoError, TodoStore } from "../extensions/todo/store.ts";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "pi-todo-")), ".pi", "TODO.md");
const op = (s, o, a) =>
	s.apply((d) => applyOp(d, o, a));

test("round-trips arbitrary markdown byte-for-byte", () => {
	const md = "# Tasks\n\nsome prose\n- [ ] #1 a  thing\n  * [X] nested [@bob]\n- not a task\n\n";
	assert.equal(serialize(parse(md)), md);
});

test("parses id, owner and blocked note in any order", () => {
	const [a, b] = items(parse("- [!] #4 wait [blocked: on API] [@eric]\n- [/] go [@pi-ab12]"));
	assert.deepEqual([a.id, a.status, a.text, a.owner, a.note], [4, "blocked", "wait", "eric", "on API"]);
	assert.deepEqual([b.id, b.status, b.text, b.owner], [undefined, "active", "go", "pi-ab12"]);
});

test("add creates the file with a header and incrementing ids", async () => {
	const s = new TodoStore(tmpFile());
	assert.equal(await op(s, "add", { who: "eric", text: "first" }), "Added #1: first");
	await op(s, "add", { who: "eric", text: "second" });
	const md = readFileSync(s.path, "utf8");
	assert.match(md, /^# Tasks\n/);
	assert.match(md, /- \[ \] #1 first\n- \[ \] #2 second\n$/);
});

test("hand-added and duplicate lines get ids on next write", async () => {
	const s = new TodoStore(tmpFile());
	await op(s, "add", { who: "eric", text: "one" });
	writeFileSync(s.path, `${readFileSync(s.path, "utf8")}- [ ] by hand\n- [ ] #1 dupe\n`);
	const ids = items(await s.list()).map((i) => i.id);
	assert.deepEqual(ids, [1, 2, 3]);
});

test("claims lock tasks against other owners unless forced", async () => {
	const s = new TodoStore(tmpFile());
	await op(s, "add", { who: "eric", text: "task" });
	await op(s, "claim", { who: "pi-a", id: 1 });
	await assert.rejects(op(s, "claim", { who: "pi-b", id: 1 }), (e) => e instanceof TodoError && /claimed by @pi-a/.test(e.message));
	await assert.rejects(op(s, "done", { who: "pi-b", id: 1 }), TodoError);
	assert.match(await op(s, "claim", { who: "pi-b", id: 1, force: true }), /took over from @pi-a/);
	await op(s, "done", { who: "pi-b", id: 1 });
	const [it] = s.items();
	assert.deepEqual([it.status, it.owner], ["done", "pi-b"]);
	await assert.rejects(op(s, "claim", { who: "pi-a", id: 1 }), /already done/);
});

test("release reopens; block keeps a note; clear drops finished work", async () => {
	const s = new TodoStore(tmpFile());
	for (const t of ["a", "b", "c"]) await op(s, "add", { who: "eric", text: t });
	await op(s, "claim", { who: "pi-a", id: 1 });
	await op(s, "release", { who: "pi-a", id: 1 });
	await op(s, "block", { who: "pi-a", id: 2, text: "needs [creds]" });
	await op(s, "drop", { who: "pi-a", id: 3 });
	assert.match(readFileSync(s.path, "utf8"), /- \[ \] #1 a\n- \[!\] #2 b \[blocked: needs \[creds\)\]\n- \[-\] #3 c\n/);
	await op(s, "clear", { who: "eric" });
	assert.deepEqual(s.items().map((i) => i.id), [1, 2]);
});

test("concurrent writers across store instances never lose updates", async () => {
	const path = tmpFile();
	const stores = Array.from({ length: 4 }, () => new TodoStore(path));
	await Promise.all(
		stores.flatMap((s, n) => Array.from({ length: 10 }, (_, i) => op(s, "add", { who: `pi-${n}`, text: `t${n}-${i}` }))),
	);
	const all = items(parse(readFileSync(path, "utf8")));
	assert.equal(all.length, 40);
	assert.equal(new Set(all.map((i) => i.id)).size, 40);
});

test("exactly one of many racing claimers wins", async () => {
	const path = tmpFile();
	await op(new TodoStore(path), "add", { who: "eric", text: "hot task" });
	const results = await Promise.allSettled(
		Array.from({ length: 6 }, (_, n) => op(new TodoStore(path), "claim", { who: `pi-${n}`, id: 1 })),
	);
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("breaks a stale lock left by a dead process", async () => {
	const s = new TodoStore(tmpFile());
	await op(s, "add", { who: "eric", text: "x" });
	writeFileSync(`${s.path}.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, token: "dead" }));
	assert.match(await op(s, "add", { who: "eric", text: "y" }), /#2/);
	writeFileSync(`${s.path}.lock`, "garbage");
	const old = new Date(Date.now() - 60_000);
	utimesSync(`${s.path}.lock`, old, old);
	assert.match(await op(s, "add", { who: "eric", text: "z" }), /#3/);
});

test("refresh picks up external edits", async () => {
	const s = new TodoStore(tmpFile());
	await op(s, "add", { who: "eric", text: "x" });
	writeFileSync(s.path, readFileSync(s.path, "utf8").replace("[ ] #1", "[x] #1"));
	assert.equal(s.refresh().length > 0 && s.items()[0].status, "done");
});
