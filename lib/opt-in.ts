/**
 * Gate for opt-in extensions.
 *
 * pi loads every extension a package declares, and settings filters can only
 * narrow that set, so "off by default" has to live in the extension itself.
 * Wrap the factory; when the extension isn't enabled it registers nothing
 * (no tools, events, or timers), so it costs nearly nothing at boot.
 *
 *   export default optIn("omlx", "Register local oMLX models", (pi) => { … });
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enabled, optIns } from "./config.ts";

export function optIn(
	name: string,
	description: string,
	factory: (pi: ExtensionAPI) => void | Promise<void>,
): (pi: ExtensionAPI) => void | Promise<void> {
	return (pi) => {
		const on = enabled(name);
		optIns().set(name, { name, description, on });
		if (on) return factory(pi);
	};
}
