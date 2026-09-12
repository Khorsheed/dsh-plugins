# Agent Note: an ownerless planned-restart report must not wake a random session

Status: implemented

English | [中文](2026-09-13-ankh-guard-ownerless-report.zh.md)

## Problem

Observed on prod 3080 (2026-09-13): an ENDED review session was woken twice by routine deploy restarts. The injection was the restart REPORT, not the interrupted-work continue. Mechanism: the deploy ran from an external CLI (no dsh session on the instance), so the restart record carried no `initiator`; `deliver()`'s owner check (`record.initiator !== undefined && id !== record.initiator`) lets an ownerless record through for EVERY agent, and the documented rule "a record without an initiator is claimed by the first root agent created" then fired the moment the user opened the ended session — its freshly created agent claimed the pending report. Before `0d4a0a93` the initiator was a username that never matched a session id, so nobody was ever woken (and the report never landed); omitting the initiator flipped the failure mode from "never delivered" to "delivered to an innocent bystander".

## Decision

Split ownerless records by kind in `deliver()` (packages/ankh-guard/src/index.ts):

- **Bare planned outcome** (`exitAt`/`pid` only — no `unexpected`, no `compositionRecovered`, no `error`): the restart was driven from outside the host and the operator's terminal already carries the announcement, so there is no in-host owner. The record is settled (`acknowledgeRestartRecord`) on the first delivery pass and NO session is woken.
- **Diagnostics someone must hear about** (`unexpected: true` unplanned recovery, `compositionRecovered: true` rollback, or an `error` failure): keep the first-root-created claim — silent is worse than a bystander for a crash or a rollback.

The merged continue+report path inherits the same predicate through `owesReport`: an interrupted session interrupted by an ownerless planned restart now gets the plain continue, not the combined message.

## Alternatives considered

**Keep first-created-claim for all ownerless records.** Rejected: it is exactly the reported incident — on an upgrade day every restart wakes whichever (possibly ended) session a user opens first.

**Settle ALL ownerless records silently.** Rejected: an unplanned recovery or a composition rollback would go unreported in-host; those are the cases where the report matters most.

**Route the report to a fixed "ops" session.** Rejected: there is no such identity in the host; inventing one is a bigger product decision than this fix.

## Consequences

Routine deploys from an external CLI no longer wake arbitrary sessions; a mounted ended session stays ended. The ownerless-claim survives only for records with diagnostics. Tests: the old "autonomous first-claim" spec flipped to the settle semantics, plus a new spec covering the three diagnostics variants. Module docs in restart-context.ts updated to the split rule.
