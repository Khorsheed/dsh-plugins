# Agent Note: a completed Kimi round's settle waits for its final wire step

Status: implemented

## Problem

Room 75844e33: every Kimi round's last reply carried no usage. Context Lens showed 助手回复 with no tokens, and the room total under-counted. The wire was complete: every step's `usage.record` sits right after its `step.begin`, final steps included. The settle mirror stopped after three quiet reads (~0.9 s, bounded at 3 s), and kimi flushed the final step later than that. The driver then finalized the reply from its live stream text, which has no usage. On the next round's first pass, those lines belonged to a closed turn and were skipped, and their usage went with them. The previous fix (`2026-10-29-kimi-round-usage-and-early-settle`) adds the uncarried remainder, but in this case the record was never read, so there was no remainder to add.

## Decision

A completed round's settle keeps polling while any live stream is still unfolded, i.e. its wire step has not landed, up to `settleFoldWaitMs` (default 10 s). Once the step lands, its fold carries the step's usage. A stopped or failed round keeps the old quiet-window rule, because its partial may never get a wire step. The wait is an optional driver timeout; tests that stream with no wire behind them set it to 0.

## Alternatives considered

- **Count late records of a closed turn into the next round.** That would misattribute them, and the reply's own footer would still be empty.
- **Raise the quiet window for every round.** That would slow cancelled rounds too, and a fixed window still loses to a slower flush.

## Consequences

Kimi replies keep their final call's usage: in the child session, in Context Lens, and in the room. A round whose wire never lands its last step (a lost flush) settles up to 10 s later than before. Records already written stay as they are.

**Not closed yet.** The same room's turn 12 (17:14, with this fix deployed since 13:46) lost its final reply's usage again. The wire wrote the step's `usage.record`, its content and its `step.end` within 8 ms. The reply was written 330 ms later without usage, and the record became the round's unattached rest, which the room total still counts. Specs that replay that shape do not reproduce it: a four-step round with parallel tools and the next step streaming before the previous fold, with the burst landing before, with, or up to 1.5 s after the prompt. So the driver now logs the two events that decide it to `<kimi home>/usage-diag.jsonl`:
- every message written from live text (`finalize-from-live`, with `via` gap or settle, the step, and whether round usage was in hand);
- every mirror pass whose usage no fold carried (`unattached`).

The next occurrence names its path.

## Testing

`local-agent-kimi` (295): a new spec resolves the prompt, writes the wire 1.5 s later, and expects the reply to carry the step's usage. The other live-driver specs run with the wait off. A multi-step spec (turn 12's shape) expects each step's usage on its own message and an empty diagnostics file. Another expects a reply finalized from live text to leave a `finalize-from-live` line.
