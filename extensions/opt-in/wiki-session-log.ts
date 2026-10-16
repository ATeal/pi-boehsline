import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { settingsFor } from "../../lib/config.ts";
import { optIn } from "../../lib/opt-in.ts";

// After each settled turn (and at shutdown), run a command with this session's
// JSONL path, so an outside tool can mirror pi sessions into a wiki or notes
// folder. Like Claude Code's Stop hook: the extension knows nothing about the
// output format; the command reads the JSONL and writes what it wants.
//
// Settings (Boehsline config, ~/.pi/agent/boehsline.json):
//   "wiki-session-log": { "command": ["~/bin/pi-session-sync"] }
// The session file is appended as the last argument. A leading ~ in the first
// argument expands. No command: the extension does nothing.
//
// Prefer an absolute path over a bare name: pi may be launched from a GUI or a
// login shell whose PATH lacks your bin folder, and a silently-unfound command
// would look exactly like "logging works" until you went looking.

const DEFAULTS = { command: [] as string[] };

export function syncCommand(): string[] {
  const raw = settingsFor("wiki-session-log", DEFAULTS).command as unknown;
  const argv = Array.isArray(raw)
    ? raw.filter((a): a is string => typeof a === "string" && a !== "")
    : typeof raw === "string"
      ? raw.split(/\s+/).filter(Boolean)
      : [];
  const [cmd, ...rest] = argv;
  if (!cmd) return [];
  return [cmd === "~" || cmd.startsWith("~/") ? join(homedir(), cmd.slice(1)) : cmd, ...rest];
}

function main(pi: ExtensionAPI) {
  let sessionFile: string | undefined;
  let running = false;
  let queued = false;

  let command: string[] = [];

  const sync = () => {
    if (!sessionFile || !command.length) return;
    // The converter rewrites the whole file, so overlapping runs would just
    // race to produce identical bytes. Collapse them into one trailing run.
    if (running) {
      queued = true;
      return;
    }
    running = true;

    const [cmd, ...args] = command as [string, ...string[]];
    const child = spawn(cmd, [...args, sessionFile], {
      detached: true,
      stdio: "ignore",
    });
    // Never let a missing or broken converter take pi down with it -- this is
    // note-keeping, not part of the agent loop.
    child.on("error", () => {
      running = false;
      queued = false;
    });
    child.on("exit", () => {
      running = false;
      if (queued) {
        queued = false;
        sync();
      }
    });
    child.unref();
  };

  pi.on("session_start", (_event, ctx) => {
    sessionFile = ctx.sessionManager.getSessionFile?.();
    command = syncCommand(); // after every package has registered its config
  });

  // agent_settled is pi's analogue of Claude Code's Stop hook: the turn is done
  // and the transcript on disk is complete through this exchange.
  pi.on("agent_settled", (_event, ctx) => {
    sessionFile ??= ctx.sessionManager.getSessionFile?.();
    sync();
  });

  // Catches the tail of a session that ends without settling (quit mid-turn),
  // and re-points at the new file when pi swaps sessions underneath us.
  pi.on("session_shutdown", () => {
    sync();
  });
}

export default optIn("wiki-session-log", "Run a command with the session file after each turn (e.g. sync to a wiki)", main);
