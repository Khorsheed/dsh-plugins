# Agent Note: CLI members ask the human through pick-to-answer cards

Status: implemented

English | [中文](2026-10-24-member-questions.zh.md)

## Problem

A CLI member that needed the human's decision wrote a numbered list of questions and options into its reply. The room grew long, and the human answered by typing "1 选②、2 选 3-5 分钟…". The host has `ask_user_question` for this, but it is out of a CLI member's reach:
- The bridge only forwards plugin tools.
- `userQuestions.ask` accepts only a live root agent as the asker. A CLI member's stand-in is not live, and a native child agent is owned by another agent (`DELEGATED_CALLER`).

## Decision

The room serves the question itself, the same way it serves member tool approvals:

- The bridge offers `ask_user_question` as a room command, with the host tool's argument shape: `questions[]` with `id`, `question`, `header`, `options[{label, description}]` and `multi_select`. `parseQuestions` also accepts the array as JSON text, since some models send only flat strings, and plain-string options.
- `receiveMemberCommand` journals `room/question` and waits up to 30 minutes. The member's call returns `{answers:[{id, selected, custom?}]}`. On expiry it fails with a text that tells the member to go on and state what it assumed.
- The room's conversation shows a card (`room-question`): one fieldset per question, options as pickable rows (radio, or checkbox for multi-select), an 其他 line, and 提交回答. `answerQuestion` records `room/question-resolved` with the answers, keeping only answers to the card's own questions, and the card folds to 你的回答：…. A card no waiting call stands behind expires on the next room access, as approvals do. Pending cards count under 需要处理.
- A CLI member's briefing tells it to use `ask_user_question` instead of writing questions into its reply.
- The CLIs bound MCP calls on their own, and Codex defaults to 60s, so a member's bridge gets 30 minutes: Codex `tool_timeout_sec=1800` on the bridge declaration, Claude Code `MCP_TOOL_TIMEOUT` when the bridge is attached. This also covers mode tools that wait on an approval.

## Alternatives considered

**Forward the host's `ask_user_question` through the stand-in.** Rejected: the host refuses a non-live or delegated asker, and its answer UI lives in the member's own session, away from the room the human watches.

**Show the card only in the member's session.** Rejected: the human works in the room. The member's session already shows the tool call.

## Consequences

- Kimi Code and dsh members get the tool, but their MCP clients keep their own default call timeout (about a minute for Kimi). A question that stays unanswered longer fails on their side, and the card then expires with the call.
- Native DSH members and the main agent are unchanged. The main agent already has the host's own `ask_user_question`.
- Tests: `questions.host.spec.ts` covers the command, answer filtering, expiry and validation. `questions.client.spec.tsx` covers the definition fold and the card's picking, typing and submission.
