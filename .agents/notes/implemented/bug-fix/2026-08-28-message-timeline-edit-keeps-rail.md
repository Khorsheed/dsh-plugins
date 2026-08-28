# Agent Note: message-timeline surfaces the message-tools edited/restored bubble without touching the baseline

Status: implemented

English | [中文](2026-08-28-message-timeline-edit-keeps-rail.zh.md)

## Problem

Live bug (message-timeline × message-tools): after editing and resending a user message, the timeline rail drained to zero rows and stayed there. message-tools' `editMessage` replaces the target message **and the surface tail**, so the host withdraws the covered nodes (out of the visible `order`) and materializes a `message-tools-edited` bubble (a restore replays as `message-tools-restored`). The rail built its rows by iterating `s.chat.order` and filtering to `user`/`steering` kinds, so the edited bubble — which the host's visible `order` does not always surface even though it renders in the flow — was never listed; editing the first message left no row at all.

Two earlier attempts (a kind-filter tweak, then reading `s.chat.nodes.values()` as the primary source) were reverted: both broke every session's rail, including ordinary unedited ones. The revert is the working baseline.

## Decision

- **The primary path is byte-identical to the baseline.** The rail still iterates `s.chat.order` and filters to `user`/`steering` kinds, producing exactly the rows an ordinary session rendered before. Adding the fix never alters the baseline — an ordinary (non-edited) session carries no message-tools nodes, so nothing changes for it.
- **Message-tools bubbles are appended, not substituted.** After the order loop, the rail walks `s.chat.nodes.values()` and appends any `message-tools-edited` / `message-tools-restored` that the order omitted and that is not explicitly `visibility: 'hidden'` (deduped by key, so a bubble the order already surfaced is not duplicated). This surfaces an edited bubble the host order dropped, so an edit never drains the rail.
- **The append degrades, it does not explode.** It is wrapped in a try/catch: if the store read fails, only the appended bubbles are dropped, and the order-derived rows still render — an ordinary session never breaks on a store quirk.

## Verification

Regression tests: an ordinary session renders exactly its order rows (baseline guard); the edited bubble appears when the host order omits it (first-message edit, order empty, store carries the edited bubble); a middle-message edit keeps the pre-edit rows plus the appended edited bubble; a store whose `values()` throws still renders the order rows (`tests/TimelineRail.client.spec.tsx`). 87 package tests pass; `pnpm build` green.

## Alternatives considered

**Kind-filter only (reverted).** `isTimelineRowKind` accepting the edited kinds does not help when the host `order` omits the bubble — the rail iterates `order`, so the bubble is never reached; and on the deployed build it coincided with every session's rail disappearing.

**Read `s.chat.nodes.values()` as the primary source (reverted).** Substituted the host's order projection, which changed how ordinary sessions render and was reverted as a regression.

**Gray placeholder rows for withdrawn originals** — the user floated this so "which one did I edit" stays locatable. Rejected: the originals are hidden (not on the surface, no jump target), the message-tools divider owns that history, and the edited bubble keeps the locatability need satisfied.

## Consequences

An in-place edit no longer drains the rail; the edited bubble (a restored replay too) is listed with its content preview and stays jumpable. Ordinary sessions are byte-for-byte unchanged. Withdrawn originals stay out of the rail by design (the divider owns that history). The reading-position resolver still treats only `user`/`steering` rows as anchors, so the lit marker does not specially target an edited bubble — a deliberate scope cut to keep the change minimal and baseline-safe.
