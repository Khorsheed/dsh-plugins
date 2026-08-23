# Agent Note: parked turns are not resumed — the resume boundary fix

Status: implemented

English | [中文](2026-08-23-parked-turn-resume.zh.md)

Implements [proposal 2026-08-23-parked-turn-resume](../../../../proposals/active/2026-08-23-parked-turn-resume.md).

## Problem

The SIGTERM snapshot judged "live turn" by `agent.status === 'running'`, but a turn blocked on user input (an open `ask_user_question`, an undecided approval) is also `running`. On 3080's upgrade day, sessions parked on question cards were woken by the resume pass on every restart — replaying reports, re-asking questions, burning turns (observed: 「梦境守护者」 woken at each of three unplanned exits). A parked turn has no interrupted work: the card persists in the log and the user answers whenever.

## Decision

- New pure probe `isParkedOnUserInput(events)` (restart-context.ts): the last interrupted turn was parked iff its tail blocks on an open `ask_user_question` call or an `approval/asked` without a matching `approval/decided`.
- The resume pass skips parked sessions entirely (no agent recreation); `deliver()` drops the continue injection for parked sessions but still delivers an owed restart report (report-only text, not the merged continue+report). The probe is memoized per boot, async (signal handlers stay sync), and fails open to the previous behavior when the persistence service is absent or errors.
- Double-fire safety: `pendingContinue` entries are deleted before the (sync) `followup` and re-armed if it throws, since two resume triggers can now race the memoized probe.
- The SIGTERM snapshot itself is unchanged (it cannot await); filtering lives in the resume/deliver path, which is also where the "parked after the snapshot" race gets caught.

## Alternatives considered

- **Filtering at SIGTERM via a pending-question service query** — no such query exists (`UserQuestionService` is a provider registry, not a pending-state store), and the handler cannot await anyway. The repaired log tail is the available source of truth.
- **Treating parked sessions as plain unaware (like idle ones) including suppressing owed reports** — rejected: an initiator that parked mid-flow still needs the restart outcome; only the continue half is dropped.

## Consequences

- Sessions parked on user input now behave like idle ones across restarts: silent. Their cards keep working (answering later is unaffected).
- Acceptance: the four-session test gains the parked case — `session-parked` in the snapshot is neither resumed nor continued, while a genuinely-working sibling is resumed and continued.
