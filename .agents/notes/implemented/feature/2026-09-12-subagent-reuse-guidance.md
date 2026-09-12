# Agent Note: model-visible guidance — one-shot subagent vs. named room member

Status: implemented

English | [中文](2026-09-12-subagent-reuse-guidance.zh.md)

## Problem

The model had no signal for choosing between a one-shot `subagent_*` delegation and inviting a named room member. The two paths differ exactly in continuity: a one-shot run returns a result and is gone; a room member keeps its own CLI session and accumulates context across rounds. Work that iterates with the same agent (review → fix → re-review) belongs on the second path, but nothing in the tool descriptions said so — and a member's name is its only function marker, yet nothing encouraged function-style names either.

## Decision

Guidance on BOTH tools, kept to description text (no behavior change):

- **`subagent_*` (local-agent-tool-subagent `familyWording`)**: this is the one-shot path; when several rounds with the SAME agent are expected and `room_invite` is available, prefer inviting a named member, named by function (`design-review`, `restart-test`) so later rounds address it by role and reuse accumulated context.
- **`room_invite` (room `tool.ts`)**: the inverse — a member persists and accumulates context, so prefer it over one-shot `subagent_*` whenever follow-ups with the same agent are expected; reserve one-shot delegations for self-contained tasks. Plus the naming hint: function-style names make a standing role visible to the human and the other members.

The split follows the family's independence rule: the subagent tool only points at `room_invite` "when available" — room's absence changes nothing.

## Verification

`pnpm --filter @khorsheed/dsh-local-agent-tool-subagent build+test` (15) and `--filter @khorsheed/dsh-room build+test` (195), both green. No test snapshots the description text. The behavioral check is a real session: give the main agent an iterative task and observe whether it invites a function-named member instead of firing one-shot delegations.

## Alternatives considered

**Change the default — route every delegation through a room.** Rejected: one-shot tasks are the majority and would pay the invite + per-dispatch roster cost for nothing; one in-flight run per member session also serializes what one-shot calls run in parallel (three concurrent reviews need three members). Guidance preserves the model's choice where it belongs.

**Put the guidance only on `room_invite`.** Rejected: the decision happens when the model reaches for a delegation tool — which is the subagent description. One side alone leaves the more common path unmarked.

## Consequences

- room's `tool.ts` is shared territory (the M3'/M4' split landed 2026-09-11): the edit is additive description text only; the room owner sees it here.
- If the model still does not pick up the pattern in real sessions, the next lever is the family tool's result text (the self-description appended to a fresh delegation's result), not more description prose.
