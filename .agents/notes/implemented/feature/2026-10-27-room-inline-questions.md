# Agent Note: A member's question sits inside its reply

Status: implemented

English | [中文](2026-10-27-room-inline-questions.zh.md)

## Problem

A member's round reads as "say part → ask (the bridge's `ask_user_question`) → get the answer → go on". The round's reply lands in the room once, at the round's end, with all its text joined. The question card had landed at the moment of asking, as a row of its own. The room therefore showed an answered card first and then a reply in which the question was followed straight by its answer, which reads as the member answering itself. The question was also tied to no round, so task views and the process flow could not place it.

## Decision

- **Question event.** `room/question` records the asker's `runId` and `before`: the last 160 characters of the round's text so far, read from the member's child session (assistant text blocks since the latest `turn/start`).
- **Reply event.** When the reply lands, `room/speech` gains `asks: [{ id, at }]`. `at` is where the recorded tail ends in the reply text; the tail is shortened (80 → 40 → 20 characters) until it is found. When nothing was said before the question, `at` is 0. When the tail is not found, `at` is −1: the question opens the reply, marked 「提问于这一轮中途」.
- **Replay.** `askLog` in the room state keeps every question with its outcome, which the inline renderings read.
- **Rendering.**
  - A question with a `runId` has no chat row of its own.
  - While it is pending, it renders at the end of the round's live card: an amber block, the run row reading 「X 在等你回答」 with a warning dot.
  - After the round, it renders inside the reply at its offset, folded to question and answer. An expired question stays answerable there, through the late-answer path.
  - The composer shows 「X 在等你回答 · 点这里回到问题 ↑」, which scrolls to the block.
- **Prompt.** The bridge tool's description asks the member not to write the questions into its text before calling and not to restate the answer after.

## Alternatives considered

**Keep two messages and dim the question-and-answer stretch of the reply.** Rejected: it still reads as two messages and loses the order things happened in.

**Show the wait time on the folded block.** Dropped at the user's request: both times are in the room log, Context Lens shows the tool call's duration, and the process flow can show it as a step.

## Consequences

- Replies from before this change carry no `asks`, so their questions keep their own rows.
- When a round is cancelled with no output there is no reply, so a question placed in that round shows nowhere. This is a known gap.
- For a kimi member, text still streaming as a preview when it asks is not in the session yet, so the split can land one sentence early.
- Rendering the `ask_user_question` tool call as a question and answer in the member's own session is Context Lens's part, still to be handed to its owner.
