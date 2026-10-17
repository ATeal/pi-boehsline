/**
 * A deferred tool (exposure: "deferred") is declared to the model only after
 * tool_search finds it, so tool_search itself has to be active. Each
 * extension with a deferred tool calls this, so it stays reachable whichever
 * of them are loaded. One small declaration (~200 tokens), added once.
 *
 * Skipped in child subagents (PI_SUBAGENT_CHILD), which stay lean, and when
 * tool_search isn't available at all (e.g. excluded by --tools).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function activateToolSearch(pi: ExtensionAPI): void {
	pi.on("session_start", () => {
		if (process.env.PI_SUBAGENT_CHILD) return;
		const active = pi.getActiveTools();
		if (active.includes("tool_search")) return;
		if (!pi.getAllTools().some((t) => t.name === "tool_search")) return;
		pi.setActiveTools([...active, "tool_search"]);
	});
}
