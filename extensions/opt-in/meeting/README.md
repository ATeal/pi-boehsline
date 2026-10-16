# meeting

*Opt-in:* `/boehsline enable meeting`.

A live meeting copilot: it follows a meeting transcript and keeps a short list
of questions worth asking out loud, using only your work models.
**Commands:** `/meeting`, `/q<N>` (research question N in the background).
**Needs:** a transcript in `~/.local/share/meeting-capture/*.jsonl`, written by
[meeting-capture](https://github.com/ericboehs/meeting-capture) or anything that
writes the same lines.

## Settings

In `~/.pi/agent/boehsline.json`. Environment variables (`PI_MEETING_*`) still override.

```jsonc
{
  "work": {
    "providers": ["github-copilot"],               // only these may read a meeting
    "models": ["github-copilot/<fast model>"],     // the scout that writes questions
    "researchModel": "github-copilot/<strong model>",  // /q research when the session model isn't a work model
    "ghHost": "github.acme.com"
  },
  "meeting": {
    "qmdCollections": ["notes"],   // background search, and /q research
    "dailyDir": "~/Notes/daily",   // the recap lands here
    "codeDir": "~/src"             // /q research can look here
  }
}
```

Environment only: `PI_MEETING_ME` (your name, else git's `user.name`),
`PI_MEETING_ABOUT` (a file about you, else `~/.pi/agent/meeting-context.md`),
`PI_MEETING_DIR` (where transcripts are), `PI_MEETING_REASONING`.

## How it works

Watches the live
[meeting-capture](https://github.com/ericboehs/meeting-capture) transcript and
keeps a list of questions worth asking. The widget above the prompt shows the
three most worth asking right now:

```text
● meeting · Weekly Sync · 16m · cert rotation · 4 checks · /meeting stop
  Q3 Has the vendor confirmed the old service is out of prod too? — Sam said maybe only dev
  Q4 Who signs off before the cert fix deploys? — no approver named
  Q6 Does the fix wait for the security review? — review not done yet
  +2 more open · 1 answered or asked · /meeting list
```

```text
/meeting start [filter|path] [--model provider/id] [--replay [speed]]
/meeting ask | focus <text> | list | recap | stop      /meeting alone shows status
/q3 [what to look for]                                 research one question (/q to pick)
```

A question leaves the list only when the scout sees it answered or asked. The
rest stay open even after the talk moves on. New questions show up right away.
Otherwise a question stays in view for three minutes before the scout's
re-ranking can swap it out. `/meeting list` expands the widget to every
question.

When the meeting ends, the recap goes into the session and into the daily note
(`meeting.dailyDir`, for the capture's date; none set, no note). It's a `###` block at the end of `## Meetings` that lists every question
as still open, answered (with the answer), or asked. A hidden marker ties the
block to its capture, so `/meeting recap` mid-meeting and the final recap
rewrite the same block. Replays never write to the note.

`/q3` researches Q3 in the background while you keep talking. It starts a
separate `pi -p` process at medium thinking, with read-only tools. It runs on
the session's model when that's a work model, and on `work.researchModel`
otherwise (`PI_MEETING_RESEARCH_MODEL` overrides it, work models only). That
process searches qmd (`meeting.qmdCollections`), Slack, your GitHub host
(`work.ghHost`), your code folder (`meeting.codeDir`) and the web. Nothing runs in the main session.
Text after the number steers the search (`/q3 check the security plan notes`), and `/q`
alone opens a picker. Each run has three minutes and at most two run at once.
The widget shows `Q3 🔎 1:20` while it works. The brief then lands as a
session message with an `Answer:` line, evidence with sources, a sharper version
of the question, and gaps. The answer also shows under the question in the
widget and as a `Researched:` line in the recap. A call that ends with research
still running waits for it before stopping. `/meeting stop` cancels research.
`/q` still works after the meeting, and a finished brief then rewrites the
daily-note recap.

With no live meeting, `start` waits for the next capture to begin. When the
recorder writes `stopped`, the widget counts down 90 seconds ("stopping in 1:12
unless it resumes") so a reconnect, which starts a new file, carries on.
`--replay 30` plays a finished transcript back at 30×, which is how to tune
the prompt without a meeting.

The model is never polled on a timer. The file is polled, and code decides
when a check is worth a call. A check runs on:

- someone else saying your name, or "any questions?"
- about six new lines followed by a pause
- 45 seconds of unchecked talk
- a flood of lines

There is never more than one check per 15 seconds. Each check sends the
transcript to a small model (`PI_MEETING_MODEL`, default the first of `work.models`).
Meetings are work text, so only work models (`work.providers`) read them. A
model from any other provider, whether from `PI_MEETING_MODEL`, `--model` or the
session, is refused with a warning. With no work model, or while a call
fails, code rules carry on: being named or "any questions?" still shows in the
widget (`! Jordan Blake named you: "…"`), but no new questions appear. Each
call stays under about 60k tokens by keeping less of the transcript's start.
The system prompt holds the background:

- `~/.pi/agent/meeting-context.md`, a few lines on who you are
- the end of the previous transcript of the same meeting
- `qmd search` hits for the meeting title

The system prompt stays fixed and the transcript is append-only, so the
provider can cache the prompt prefix. A replay of a 33-minute meeting took
five checks.

New questions and suggested replies also go into the session as `meeting`
messages sent with `triggerTurn: false`. They land in the transcript and in the
main model's context, but the main model doesn't start a turn. Ask it "what
should I say?" and it already has them, plus the transcript path. The old
`--wake` flag is gone: a meeting never starts a turn. Meeting prep lives in the
[watcher](../watch/README.md#proactive).

Teams writes a caption only when it scrolls out of its ~3-line window, so the
copilot runs a couple of utterances behind the room.
