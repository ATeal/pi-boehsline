/**
 * Import first in watch and meeting tests. It points Boehsline at
 * fixtures/acme-boehsline.json (subprocesses inherit the env), enables the two
 * opt-in extensions, and applies the settings to the already-loaded modules,
 * the way session_start does in pi.
 */
import { fileURLToPath } from "node:url";

process.env.BOEHSLINE_CONFIG = fileURLToPath(new URL("../fixtures/acme-boehsline.json", import.meta.url));
process.env.BOEHSLINE_ENABLE = "watch,meeting";

const { applySettings } = await import("../../extensions/opt-in/watch/index.ts");
const { applyMeetingSettings } = await import("../../extensions/opt-in/meeting/index.ts");
applySettings();
applyMeetingSettings();
