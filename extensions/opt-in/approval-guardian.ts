/**
 * approval-guardian, opt-in.
 *
 * The guardian (packages/approval-guardian, a git subtree kept verbatim) is a
 * fail-closed gate: risky tool calls wait for a reviewer model or for you. It
 * shouldn't switch on for someone who just installed Boehsline and hasn't set it
 * up, so this wrapper gates it like the other opt-ins:
 *
 *   /boehsline enable approval-guardian
 *
 * The manifest loads this file instead of the package's own entry.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { optIn } from "../../lib/opt-in.ts";

// A dynamic import keeps the root typecheck out of the subtree (it has its own
// tsconfig and looser index checks) and skips loading it at all when it's off.
const GUARDIAN = new URL("../../packages/approval-guardian/extensions/index.ts", import.meta.url).href;

export default optIn(
	"approval-guardian",
	"Fail-closed approval gate: a reviewer model checks risky tool calls",
	async (pi: ExtensionAPI) => {
		const { default: approvalGuardian } = (await import(GUARDIAN)) as { default: (pi: ExtensionAPI) => unknown };
		await approvalGuardian(pi);
	},
);
