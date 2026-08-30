# Agent Note: Speech blocks wear a member-color rail and collapse; the roster rides the prompt only on change

Status: implemented

English | [中文](2026-08-30-speech-readability-and-roster-on-change.zh.md)

This note records two readability/thrift changes to `@khorsheed/dsh-room`: the member speech block's visual identity, and the dispatch prompt's roster carry rule.

## Problem

Member replies landed on the timeline as large undifferentiated text blocks: nothing at a glance told which member said what, and a long reply flooded the flow. Separately, every dispatch prompt carried the full roster section (member list with roles plus the notification protocol) even though the member's own session already held it from the previous dispatch — repeated cost with zero information gain.

## Decision

**The whole speech block wears a 2px member-color rail.** `RoomSpeechView.tsx` sets an inline `borderLeft: 2px solid <memberColor(member)>` on the root with 8px of `padding-left` clearance (stylesheet comment: it is an identity band — "this whole block is one member's speech" — not a separator rule). The rail spans identity row, body, and action row, reusing the stable name-hash palette (`member-color.ts`) the roster and @-candidates already use.

**A speech longer than 600 chars starts collapsed.** Chars, not rendered lines: a stable threshold needing no layout measurement (~10 rendered lines). The clamp is visual only (`max-height: 240px; overflow: hidden`) over the fully rendered `MarkdownText`, with a 48px `linear-gradient` fade rebased onto `--dsw-alias-bg-base` (the official transcript-mask shape from `ConversationRoot.module.css`) and an expand/collapse toggle in the `MembersView` expandToggle chrome (business-primary text button; new locale keys `speech.expand`/`speech.collapse`, zh 展开全部/收起).

**The roster section rides the prompt only when stale.** A new pure journal derivation `rosterStaleSince(events, cursor)` answers whether the roster a member last saw changed: true for a never-dispatched member, or when a `room/member-added`/`room/member-removed`, or a roster-VISIBLE `room/member-updated` (instructions = the one-line role, rename = the addressing name) has a seq past the member's dispatch cursor (`previousCursor`). A childSessionId/cwd-only update is roster-invisible — the delegation handle is journaled right after a first run, and counting it would re-send the roster on every member's next dispatch for nothing. The room GOAL moved out of the roster section into its own line carried on EVERY dispatch (cheap, orients the task); notifications carry as before.

## Alternatives considered

- **Line-count collapse (measure rendered height).** Rejected: measurement needs layout observers and re-checks on resize/font changes; the char threshold is deterministic and testable in jsdom, at the cost of occasionally collapsing a short-but-wide or sparing a long-but-narrow text.
- **Counting every `member-updated` as roster-stale.** Rejected: the childSessionId handle journaled after each member's first run would make the roster ride essentially every dispatch, defeating the throttle.
- **Keeping the goal heading the roster section.** Rejected: with the roster conditionally absent, the goal would vanish with it; the goal is cheap and orients every task, so it earned its own always-carried line.

## Consequences

- 183 tests green (176 prior + 7 new): rail presence/color, collapse toggle behavior, short-speech no-toggle, `rosterStaleSince` unit coverage (first dispatch, add/remove, visible vs invisible updates, cursor boundary), and integration coverage (roster on first dispatch, omitted when unchanged, re-carried after a member join, not re-carried by the childSessionId journaling; goal line on every dispatch).
- Member prompts shrink by the roster section on steady-state dispatches; the first dispatch after any roster change re-teaches it, so a member never acts on a stale roster for long.
- **Link-install hazard surfaced (scratch workaround in place):** a `link:`-installed plugin resolves `@deepseek-ai/dsh-session` to the repo's own node_modules copy, so room's `KNOWN_SESSION_EVENT_TYPES` registration never reaches the toolchain copy the persistence READ path consults — cold room sessions refuse to load (`SessionFormatUnsupportedError`) in linked dev instances, live ones work. The 3199 scratch profile carries a `room-catalog-shim` bundle (in `~/code/dsh-scratch-uicheck/`, not this repo) that imports the toolchain's module by absolute path and registers the vocabulary. Prod 3080 also `link:`s these packages — whether cold room reads fail there is unverified and worth checking before the next room deploy.
- Verified on the 3199 scratch instance with a hand-crafted journaled room session (two members, one 609-char speech, one short): `scratch-screenshots/speech-rail-collapsed.png` (rails + collapsed + fade + 展开全部) and `scratch-screenshots/speech-expanded.png` (full text + 收起).
