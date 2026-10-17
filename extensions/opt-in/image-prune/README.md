# image-prune

*Opt-in:* `/boehsline enable image-prune`.

Takes old images out of the model's context once they add up. **Command:** `/image-prune [now]`.

pi resends every image in context as base64 on every request until the next compaction, and base64 PNGs don't compress. Over 14 days a third of requests carried images: median 2 MB, p90 10 MB, worst 23 MB (33 PNGs).

At the end of each turn it adds up the images the next request would send. Past `thresholdMB`, it replaces, in one batch, every image older than the last `keepTurns` user turns with a note:

```
[image removed to save context: /Users/me/shot.png, image/png, ~412 KB. Use the read tool on the path to view it again.]
```

- The entry's text, role and metadata stay; only its images change. User messages, tool results (error results too) and extension messages with images are all covered.
- A read tool result points at the file it read. A pasted or tool-made image has no file, so it's saved first to `~/.pi/agent/tmp/image-prune/<sha256>.<ext>`.
- One batch, only past the threshold. Each change to earlier context rewrites the prompt cache from that point, so pruning one image per turn would cost more than it saves. After a batch the visible images are well under the threshold, so it doesn't fire again until more pile up. It also waits while the prunable images are under a quarter of the threshold, so recent images alone don't cause an edit every turn.
- The edits are `context_edit` entries in the session: later requests share a stable prefix, the transcript and `/tree` still show the images, and branching back before the edit brings them back. It goes by pi's session projection, so nothing before the latest compaction's kept boundary is touched.
- It doesn't start another request; the edits apply to the next one.

`/image-prune` shows how many images are in context, their size, and how much is old enough to prune. `/image-prune now` prunes at the next turn end whatever the size (commands can't edit context themselves, so when pi is idle the next request still carries the images).

```jsonc
// ~/.pi/agent/boehsline.json
{ "image-prune": { "thresholdMB": 5, "keepTurns": 2 } }  // "enabled": false pauses automatic pruning
```
