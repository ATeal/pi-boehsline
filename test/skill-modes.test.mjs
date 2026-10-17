/**
 * Tests for skill-modes: sticky skill modes entered with /skill:<name>.
 *
 * Runs the real extension against stub pi/ctx objects. Skills are real
 * SKILL.md files in a temp dir, since the extension reads their frontmatter.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "pi-skill-modes-"));

function skill(name, frontmatter) {
  const file = path.join(dir, name, "SKILL.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `---\nname: ${name}\n${frontmatter}---\n\n# ${name}\n`);
  return { name, filePath: file };
}

const POTETO = skill(
  "poteto-mode",
  "mode: true\nreminder: Review against the checklist before done.\nicon: crown\ncolor: yellow\n",
);
const PLAIN = skill("plain", "description: not a mode\n");
const SKILLS = [POTETO, PLAIN];

async function load(enabled = true) {
  if (enabled) process.env.BOEHSLINE_ENABLE = "skill-modes";
  else delete process.env.BOEHSLINE_ENABLE;
  const url = new URL("../extensions/opt-in/skill-modes/index.ts", import.meta.url);
  url.search = `?t=${Math.random()}`;
  return (await import(url.href)).default;
}

/** Mount the extension; `branch` seeds the session's entries for restore. */
async function mount({ branch = [], enabled = true } = {}) {
  const extension = await load(enabled);
  const handlers = {};
  const commands = {};
  const entries = [...branch];
  const status = {};
  const notes = [];
  const pi = {
    on: (name, handler) => (handlers[name] = handler),
    registerCommand: (name, spec) => (commands[name] = spec),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
  };
  await extension(pi);
  const ctx = {
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: {
      setStatus: (key, text) => (status[key] = text),
      notify: (message, level) => notes.push({ message, level }),
      theme: { fg: (tone, text) => `<${tone}>${text}` },
    },
  };
  /** Send a prompt the way pi does: input, then before_agent_start. */
  const run = (text) => {
    handlers.input?.({ text }, ctx);
    const event = { systemPromptOptions: { skills: SKILLS, sections: {} } };
    handlers.before_agent_start(event, ctx);
    return event.systemPromptOptions.sections;
  };
  return { handlers, commands, entries, status, notes, ctx, run };
}

test("off unless enabled: registers nothing", async () => {
  const ui = await mount({ enabled: false });
  assert.deepEqual(Object.keys(ui.handlers), []);
  assert.deepEqual(Object.keys(ui.commands), []);
});

test("/skill:<mode> turns the mode on and every later run carries its reminder", async () => {
  const ui = await mount();
  ui.handlers.session_start({}, ui.ctx);
  assert.equal(ui.run("hello").skill_modes, undefined, "no section while no mode is on");

  const first = ui.run("/skill:poteto-mode tidy this").skill_modes;
  assert.match(first, /- poteto-mode \(.*SKILL\.md\): Review against the checklist before done\./);
  assert.equal(ui.status["skill-mode"], "<warning>👑 poteto-mode");
  assert.deepEqual(ui.entries.at(-1).data.modes, [{ name: "poteto-mode", filePath: POTETO.filePath }]);

  // Sticky: the next ordinary prompt gets the identical section (cache-stable).
  assert.equal(ui.run("next task").skill_modes, first);
});

test("a skill without mode: true is not sticky", async () => {
  const ui = await mount();
  assert.equal(ui.run("/skill:plain do it").skill_modes, undefined);
  assert.equal(ui.entries.length, 0);
});

test("/mode off leaves the mode and drops the section", async () => {
  const ui = await mount();
  ui.run("/skill:poteto-mode");
  await ui.commands.mode.handler("off poteto-mode", ui.ctx);
  assert.equal(ui.notes.at(-1).message, "Left poteto-mode.");
  assert.equal(ui.run("after").skill_modes, undefined);
  assert.equal(ui.status["skill-mode"], undefined);
  await ui.commands.mode.handler("off", ui.ctx);
  assert.equal(ui.notes.at(-1).message, "No mode on.");
});

test("modes are restored from the session branch", async () => {
  const branch = [
    { type: "custom", customType: "skill-mode", data: { modes: [{ name: "poteto-mode", filePath: POTETO.filePath }] } },
  ];
  const ui = await mount({ branch });
  ui.handlers.session_start({}, ui.ctx);
  assert.match(ui.run("resumed").skill_modes, /poteto-mode/);
  await ui.commands.mode.handler("", ui.ctx);
  assert.match(ui.notes.at(-1).message, /^Active: poteto-mode\./);
});
