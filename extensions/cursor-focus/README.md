# cursor-focus

Replaces pi's fake reverse-video prompt cursor with your terminal's real cursor.

pi already marks the editor's cursor position; this turns on the hardware cursor there and removes the drawn block, so the two never overlap. tmux and the terminal then handle focus as they do everywhere else:

- active pane, focused terminal: the normal cursor
- active pane, unfocused terminal: the terminal's inactive cursor style
- inactive pane: no cursor
