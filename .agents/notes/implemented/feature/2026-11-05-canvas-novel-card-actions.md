# Agent Note: Novel card actions share one menu and memory corrections append manually

Status: implemented

## Problem

Novel surfaces put delete buttons in different places, gave little indication that a person card opened a detail page, and hid editable memory behind inconsistent controls. “当前打算” and “相信的事” were reconciliation journals, so turning them into ordinary card fields would have destroyed provenance and let the next reconciliation erase the person's correction.

## Decision

- World, people, relation and foreshadow headers use `NodeActions`, one fixed ⋯ menu with details first and the existing delete preview behind it. Person cards also expose an explicit “查看详情” door and a hover treatment. Read-only seats show a 只读 tag and retain reading actions while hiding writes.
- “此刻” keeps its whole-state editor. “当前打算” and every belief use the same 手动修正 door and editor.
- A correction appends a `minds.jsonl` entry with `origin=manual`, the current chapter and the belief's epistemic source where relevant. It does not fabricate evidence or replace an extracted entry.
- Reconciliation replaces only non-manual rows for that chapter. Manual corrections always pass the writing brief's chapter cutoff, so they are visible immediately; automatic rows keep the old cutoff. The latest intent and recent beliefs therefore include human corrections without losing extraction history.
- `correctMind` is available through the typed Remote and shares the session fence with other panel writes.

## Alternatives considered

- **Edit beliefs and intent in place.** Rejected: the journal would lose the extracted original and its chapter evidence. An append-only correction preserves both accounts.
- **Use the chapter cutoff for manual rows too.** Rejected: a correction made at the current chapter would disappear from the very next writing brief. Manual origin deliberately bypasses only that cutoff, not any validation.
- **Leave delete inline beside each card.** Rejected: position and emphasis drifted from the canvas detail page. One header menu is predictable and keeps destructive actions out of the reading flow.

## Consequences

- Users can see which cards open, which fields change, and what a correction does. Read-only and writable seats differ visibly.
- Re-reconciliation cannot silently remove manual corrections. New automatic memories still supersede earlier automatic rows for the same chapter.
- Tests cover manual corrections in the brief, repeated reconciliation, the typed UI write path, read-only hiding, and the fixed menu. The full novel suite passes 40 files and 291 tests.
