# image-preview

Real images inside tmux: `read` shows pictures inline, and `/preview` opens one full size. **Command:** `/preview [path]`. **Needs:** [`chafa`](https://hpjansson.org/chafa/).

Makes `read` show pictures inline under tmux. pi
deliberately disables inline images inside tmux (`images: null` in
`terminal-image.js`), and tmux strips the raw Kitty APC sequences a terminal
would need unless they are DCS-wrapped; the upstream attempt is still gated
behind `PI_TMUX_IMAGES` ([earendil-works/pi#2374](https://github.com/earendil-works/pi/issues/2374)).
The extension renders in userspace instead: chafa encodes the image with
`--format=kitty --passthrough=tmux`, which wraps each Kitty command in
`\x1bPtmux;…\x1b\\` and uses `U=1` Unicode placeholders, so the terminal gets
real pixels anchored to text cells (the yazi/ranger approach) instead of
character art.

pi-tui rewrites every row of the alt-screen viewport whenever an image line
changes, so every editor growth or autocomplete pop-up used to re-send chafa's
raw RGBA transmission — 791 KB collapsed, 4.8 MB expanded for a screenshot —
and typing became unusable. The fix is to transmit once per rendered size and
then render only the placeholder rows: after the first frame the DCS prefix is
stripped (`lastIndexOf("\x1b\\")`) and steady-state frames are ~330 bytes, so
shifts and scrolling cost the same as text. Re-transmission happens only when
the width or expand state changes, which is when a new encoding is needed
anyway.

The fallback chain is pixels → braille → pi's built-in text renderer. The
braille pass uses `--symbols=half+braille` rather than chafa's `all` set, whose
legacy-computing glyphs many fonts lack; every line was checked against
pi-tui's `visibleWidth` so it matches the cell count chafa targeted. It only
takes over when tmux and a Kitty-capable outer terminal (Ghostty, Kitty,
WezTerm, Warp) are detected and pi has no native image support; outside tmux pi
renders images itself. `PI_INLINE_KITTY_IMAGES=0` forces the braille path.

`/preview [path]` opens the last-read image (or a path) in a `tmux
display-popup` at 90% × 90%, using the same chafa kitty+passthrough encoding
for a full-size view; any key dismisses it. Outside tmux it hands the path to
`open` (or `xdg-open`).

One-shot transmission has one visible cost: rows rendered while off-screen
never sent their transmission, so images from a restored session can be blank
until the file is read again or viewed with `/preview`. Boot cost is a single
small module with no work at load; chafa is spawned lazily and cached per
width/expansion.
