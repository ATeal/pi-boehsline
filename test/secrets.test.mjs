import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";

process.env.BOEHSLINE_CONFIG = join(mkdtempSync(join(tmpdir(), "boehsline-")), "none.json");
const { registerSource, sources } = await import("../lib/config.ts");
const { envOrSecret, readSecret, secretArgv, secretSettings, secretSourceLabel } = await import("../lib/secrets.ts");

beforeEach(() => sources().clear());

/** A fake secret CLI: prints "value-for-<last arg>", fails for NOPE, hangs for SLOW. */
function fakeCli() {
	const dir = mkdtempSync(join(tmpdir(), "secrets-"));
	const bin = join(dir, "vault");
	writeFileSync(bin, '#!/bin/sh\nfor a; do last=$a; done\ncase "$last" in *NOPE*) exit 1;; *SLOW*) sleep 5;; esac\necho "value-for-$last"\n');
	chmodSync(bin, 0o755);
	return bin;
}

test("default command is fnox get; the name is appended", () => {
	assert.deepEqual(secretSettings().command, ["fnox", "get"]);
	assert.deepEqual(secretArgv("KEY"), ["fnox", "get", "KEY"]);
	assert.equal(secretSourceLabel(), "fnox");
});

test("{name} fills a slot instead of appending; [] means env only", () => {
	assert.deepEqual(secretArgv("KEY", ["op", "read", "op://Private/{name}/credential"]), ["op", "read", "op://Private/KEY/credential"]);
	assert.equal(secretArgv("KEY", []), null);
	assert.equal(secretSourceLabel([]), "env only");
	assert.equal(secretSourceLabel(["/opt/homebrew/bin/op", "read"]), "op");
});

test("a configured command runs; failures and timeouts are just no value", async () => {
	const bin = fakeCli();
	registerSource("t", { secrets: { command: [bin], timeoutMs: 300 } });
	assert.equal(await readSecret("API_KEY"), "value-for-API_KEY");
	assert.equal(await readSecret("NOPE_KEY"), undefined);
	assert.equal(await readSecret("SLOW_KEY"), undefined);
	registerSource("t", { secrets: { command: [join(bin, "missing")] } });
	assert.equal(await readSecret("API_KEY"), undefined, "a missing CLI never throws");
});

test("env wins; the command is only asked when env is empty", async () => {
	registerSource("t", { secrets: { command: [fakeCli()] } });
	assert.equal(await envOrSecret("API_KEY", { API_KEY: " from-env " }), "from-env");
	assert.equal(await envOrSecret("API_KEY", {}), "value-for-API_KEY");
});
