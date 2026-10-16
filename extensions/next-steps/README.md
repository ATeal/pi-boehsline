# next-steps

Pick a numbered "Next steps:" option by typing its number: `/2`, `/13`, `/2 but ssh`.

When a reply ends with a numbered "Next steps:" block, next-steps
makes the number itself the command:

```text
/2            # puts step 2 in the editor, verbatim
/13           # step 1, then AND, then step 3
/31           # same two steps, in the order asked for
/2 but ssh    # step 2 with an extra instruction appended
```

It expands rather than sends: the step lands in the editor as ordinary text, to
be trimmed, argued with, or abandoned with Ctrl+C, and Enter sends it like
anything else. Tab on the completion does the same thing one keystroke earlier,
and it works mid-prompt too — `write it up, then /2` + Tab swaps the token in
place and leaves the sentence around it alone, on any line, at any depth. A
slash only counts when it opens a word, so `1/2` and `src/2` are still a
fraction and a path.

Any digit string in any order works, de-duplicated left to right. The steps are
unwrapped back into one paragraph each — the line breaks in a reply are the
terminal's width, not the instruction — and the sentence after the list ("which
one do you want?") stays out of it. Steps come from the newest reply on the
branch that actually has a numbered list, looking back at most three, so a
one-line answer in between does not lose the menu; reaching back says so.

It hangs off the `input` event rather than `pi.registerCommand`, because the
commands would have to be registered for every permutation (15 for a three-step
list) before any reply exists to number. The trade is discovery — extension
commands appear in the `/` menu and this does not — so it adds an autocomplete
provider that lists the steps with their own text as the description: `/1` then
offers `/12` and `/13`.

One sharp edge is load-bearing there. pi's editor applies the highlighted
completion when Enter is pressed and then *submits* it — but only when the
autocomplete prefix starts with a slash, which is what makes Enter on `/mod` run
`/model`. Reporting the prefix as `13` instead of `/13` opts out of that
fall-through, so Enter expands and stops. It also fixes pi's highlight, which
matches the prefix against item values and so never matched anything while the
slash was still attached.

Mid-prompt behaves slightly differently, and for the same kind of reason. pi
only auto-opens the popup for a slash in column zero of line one, so there is
no menu as you type; and it applies a *forced* completion (any Tab outside a
start-of-line slash command) without drawing one when exactly one item comes
back. So mid-prompt the provider returns only the exact selection: one Tab,
expanded, no menu. The combo entries stay a start-of-line affordance — type
`/12` mid-sentence and it expands both. Two smaller edges: pi's built-in
provider vetoes forced completion for a line that is only a slash command,
which would kill Tab on a `/2` alone on line two, so the provider overrides
`shouldTriggerFileCompletion` for its own invocations; and the `input` backstop
stays anchored to the whole message, so `…and /2` submitted without Tab reaches
the model as typed rather than being rewritten out from under it.
