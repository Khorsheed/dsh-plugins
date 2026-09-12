# Agent Note: deploy-3080 must not pass a username as the restart report's routing session

Status: implemented

## Problem

Every `deploy:3080` restart orphaned its restart report. The deploy script defaulted `--initiator` to `$USER` ("zhuyudan") and passed it to `ankh-guard schedule-exit` unconditionally — but the guard's `--initiator` contract is the **session id** the post-restart report is routed to (its own default, `$DSH_SESSION_ID`, was correct). A record whose initiator is a username is claimable only by a session with that exact id — which never exists — so it stayed pending until the next restart overwrote it: the report was silently lost, and the session that ran the deploy only received the interrupted-turn continuation text, never the canary receipt (2026-09-12, file-preview/inline-html-render/ui-file-preview deploy; defect report with full evidence chain: guard warning in the deploy log, `last-restart.json` with no `reportedAt`, the two retirement paths in restart-context.ts).

## Decision

`scripts/deploy-3080.mts` no longer has a default initiator: the `--initiator` flag reaches `schedule-exit` only when the operator explicitly names a session id. With the flag omitted, ankh-guard routes the report to its caller's `$DSH_SESSION_ID` — the session that actually ran the deploy — which is the wake-up the flow always intended. The human attribution the announcement needs is a separate concern: the 通报 line now prints `操作者:$USER` directly, so "who ran it" and "which session gets the receipt" no longer share one variable. The spec asserts both arms: a default restart run's `schedule-exit` call carries no `--initiator`, and an explicit `--initiator session-abc` passes through verbatim. `docs/ops.md`'s deploy usage block documents why a non-session id orphans the report.

## Alternatives considered

- **Defaulting the flag to `$DSH_SESSION_ID` explicitly** — identical in effect to omitting it (that is the guard's own default), but it duplicates the guard's contract into the deploy script and can drift; omission delegates to the contract owner.
- **Keeping `$USER` and letting the guard warn** — that WAS the old behavior: the guard's resolveInitiator warns loudly but does not refuse (scheduling for someone else is a sanctioned use case), so the footgun fired on every single deploy. Defaults must route correctly; overrides remain available.
- **Renaming the flag** (`--report-to`) — clearer, but the flag is a pass-through of the guard's own `--initiator`; keeping the name keeps the pass-through honest, and the danger was the default, not the name.

## Consequences

- Restart reports (canary verdict, receipt) once again wake the session that ran the deploy; the interrupted-turn continuation text is no longer the only feedback.
- `last-restart.json` records carry a real session id as initiator (or none), so the record retires on delivery instead of lingering until overwrite.
- Given up: nothing — the 通报 still attributes the human operator, now from `$USER` directly.

## Testing

`scripts/deploy-3080.spec.ts` gains the two-arm assertion above; `pnpm run test:scripts` green.
