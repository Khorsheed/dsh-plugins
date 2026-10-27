# Agent Note: An expired question card can still be answered

Status: implemented

English | [中文](2026-10-27-room-question-late-answer.zh.md)

## Problem

A CLI member's `ask_user_question` waits on a call inside the member's process. A host restart ends that process, and so does the 30-minute timeout. The room then marks the card 已过期，未作答 and the human's answer has nowhere to go, even though the member asked because it needed the answer to go on.

## Decision

- An expired card stays answerable. The status reads 已过期，仍可回答 and the form stays open.
- A late answer journals `room/question-resolved` with `late: true` (the card reads 已补答). The answers reach the member as a new human-origin `room/dispatch`: each question with the pick, then "go on with these, and adjust what you assumed". The dispatch wakes the member with its own context, like any human message. No `user/message` is written, because the card already shows the answers.
- A card with no waiting call and no resolution yet (a restart this room has not swept) is treated the same way.
- A consent gate (room_help's 允许 / 不允许 card, marked `consent: true`) is never answered late. Its call already decided.

## Alternatives considered

**Write the answers as the human's own message (`user/message`).** Rejected: the card already shows them, so the room would show the same answers twice.

**Keep the call alive across a restart.** Not possible: the call lives in the member's CLI process, which ends with the host.

## Consequences

- An answer to an expired card is accepted once. A second one is refused with `question-not-pending`.
- Consent cards journaled before this change carry no `consent` flag. They would accept a late answer, which only sends the member a message.
