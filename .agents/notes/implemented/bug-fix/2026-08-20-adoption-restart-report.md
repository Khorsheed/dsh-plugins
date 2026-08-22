# Agent Note: the adoption takeover reports back to its supervising session

Status: implemented

English | [中文](2026-08-20-adoption-restart-report.zh.md)

## Problem

Fresh-machine install testing showed a first-run UX hole: the agent installs the plugin, establishes supervision (`supervise`), and ends its turn promising "I'll verify and report once the service recovers". The adoption bounce then kills and replaces the instance — but a takeover writes no restart marker and no outcome record, so the report machinery has nothing to deliver: the driving session parks, and the user (who does not know the protocol) stares at a stopped page. The scheduled-restart path already reported back via `last-restart.json` + initiator followup; the adoption path — the FIRST restart every deployment ever sees — was the silent one.

## Decision

- `supervise` captures the calling session (`$DSH_SESSION_ID`) and hands it to the watchdog as `WD_INITIATOR`; it also decides adoption-vs-first-boot at spawn time (`WD_ADOPTION=1` when a live owner listens on the port) — probing for the owner inside the watchdog would race the owner's exit (observed in the integration test: the host died before the watchdog's first `lsof`).
- On the first healthy boot, when there is no boot stamp yet and `WD_ADOPTION=1`, the watchdog calls the new `record-adoption` CLI verb, which writes a `last-restart.json` outcome (`writeAdoptionRecord`, with the same pending-record protection as `record-unexpected-exit`). The plugin's existing report machinery then wakes the supervising session with the outcome — the first restart reports back exactly like a scheduled one.
- A first-EVER boot (no owner at supervise time, `WD_ADOPTION=0`) files nothing: the no-false-positive-on-first-contact guard is preserved, now with an explicit test of its own.

## Alternatives considered

- **Detect the previous owner inside the watchdog** (an `lsof` probe before the takeover wait) — racy by construction; the CLI knows the answer synchronously at supervise time, so the fact travels in the environment.
- **A docs-only mitigation** (teach the skill/README to warn "send any message to wake me after the first bounce") — pushes protocol knowledge onto the user; the report machinery already existed, the adoption path just never fed it.

## Consequences

- A human-driven `supervise` (no `$DSH_SESSION_ID`) writes an initiator-less record, claimed by the first root agent created — the same messenger semantics as crash-recovery records.
- The existing takeover test's "no record on first boot" assertion was updated: it conflated first-ever boot with adoption takeover; each case now has its own test (100/100 green).
