# Agent Note: Novel card actions share one menu and memory corrections append manually

Status: implemented

## Problem

Novel surfaces put delete buttons in different places, gave little indication that a person card opened a detail page, and hid editable memory behind inconsistent controls. The generic canvas archive well kept restore and delete inline, typed field and novel memory editors did not share the source editor's keyboard contract, and read-only coverage exercised a proposed card rather than a genuinely session-less kept card. “当前打算” and “相信的事” were reconciliation journals, so turning them into ordinary card fields would have destroyed provenance and let the next reconciliation erase the person's correction.

## Decision

- World, people, relation and foreshadow headers use `NodeActions`, one fixed ⋯ menu with details first and the existing delete preview behind it. Person cards also expose an explicit “查看详情” door and a hover treatment. The generic canvas archive well uses the same `MoreMenu` for restore and delete instead of inline buttons.
- “此刻” keeps its whole-state editor. “当前打算” and every belief use the same 手动修正 door and editor. The existing explanation that manual corrections enter later writing briefs and survive reconciliation stays visible.
- Typed `FieldForm` and both novel memory editors accept ⌘⏎/Ctrl+Enter to save and Escape to cancel from any field, and display that hint beside their save/cancel buttons. The Markdown block hint names Escape as well as its existing save chord; HTML and Markdown source editing retain the existing `CardTextarea` behavior.
- Read-only seats show a 只读 tag and retain reading actions while hiding writes. Generic detail coverage uses a kept card with `sessionId=undefined` and checks menus, typed fields, body editing and comments, not merely a proposed card.
- A correction appends a `minds.jsonl` entry with `origin=manual`, the current chapter and the belief's epistemic source where relevant. It does not fabricate evidence or replace an extracted entry.
- Reconciliation replaces only non-manual rows for that chapter. Manual corrections always pass the writing brief's chapter cutoff, so they are visible immediately; automatic rows keep the old cutoff. The latest intent and recent beliefs therefore include human corrections without losing extraction history.
- `correctMind` is available through the typed Remote and shares the session fence with other panel writes.

## Alternatives considered

- **Edit beliefs and intent in place.** Rejected: the journal would lose the extracted original and its chapter evidence. An append-only correction preserves both accounts.
- **Use the chapter cutoff for manual rows too.** Rejected: a correction made at the current chapter would disappear from the very next writing brief. Manual origin deliberately bypasses only that cutoff, not any validation.
- **Leave archive-well actions inline.** Rejected: it preserves exactly the inconsistent destructive-action placement the unified card headers removed.
- **Change only the shortcut hint text.** Rejected: the old textarea and memory editors still lacked the advertised behavior. The form-level handlers implement the same save/cancel contract everywhere.

## Consequences

- Users can see which cards open, which fields change, and what a correction does. Restore and delete occupy one predictable menu across kept and archived cards, and keyboard hints match actual behavior. Read-only and writable seats differ visibly.
- Re-reconciliation cannot silently remove manual corrections. New automatic memories still supersede earlier automatic rows for the same chapter.
- Tests cover manual corrections in the brief, repeated reconciliation, typed UI writes, ⌘⏎ save and Escape cancel, the archive-well menu, the fixed card menu, and a genuinely session-less kept card.
