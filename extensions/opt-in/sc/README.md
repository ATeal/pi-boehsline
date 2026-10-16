# sc

*Opt-in:* `/boehsline enable sc`.

Attaches the newest file in iCloud Drive's Downloads folder to the conversation. **Command:** `/sc [instructions]`.

The use case is being away from the Mac: share a screenshot on an iPad or iPhone to Files → iCloud Drive → Downloads, SSH home, and run `/sc what does this error say`. The image lands in the session as if you'd pasted it locally.

- Images (PNG, JPEG, GIF, WebP) are attached inline, with their path so tools can reach the file too.
- Other files are sent by path for the agent to read.
- A file iCloud hasn't downloaded yet (`.icloud`) is reported instead of skipped: open it once on a signed-in device.
- It steers: while the agent is working, the attachment arrives before its next request.

**Needs:** macOS with iCloud Drive.
