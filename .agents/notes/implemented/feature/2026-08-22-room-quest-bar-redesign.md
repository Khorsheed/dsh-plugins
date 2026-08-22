# Agent Note: room — quest-bar redesign (goal ring capsule + Linear-style task panel)

Status: implemented

English | [中文](2026-08-22-room-quest-bar-redesign.zh.md)

## Problem

The dual-capsule A/B ([the chrome-variants note](2026-08-20-room-capsule-chrome-variants.md)) settled nothing: the user rejected both candidates. Variant A's capsules read as two anonymous chips with unicode ◐/▦ stand-ins, and variant B's text row threw the goal — the dock's most important information — away into tertiary grey. The redesign brief: the goal's progress ring must be the collapsed row's single visual focus, the task capsule must carry a real checklist icon plus who is running, and the task panel must read like Linear (color-dot filter chips, small-caps group headers, colored status icons, member chips, right-aligned grey meta).

## Decision

One design ships; the `data-variant` switch, `CAPSULE_VARIANT`, and both chrome blocks are deleted (`RoomDockCapsules.tsx` / `.module.css`). Behavior is unchanged — filter, add, edit, close, blocked greying, advances, goal edit all survive; only structure and styling moved.

**Collapsed row.** The goal capsule leads with an SVG progress ring (tertiary track arc, business-primary progress arc, `-90°` rotated) followed by the rounded percent and the truncated goal text; without a goal it renders the 「＋ 设定目标」 guide with no ring. The task capsule leads with `IconChecklistOutline14` from the official primitives (unicode glyphs are gone for good), then the open count (pending + in_progress; cancelled excluded) and the running members as color-dot + name chips with a localized 在做/doing suffix. Both capsules ride the official chip register (28px, r24, interactive hover fill, 13/20/500) and keep the ToolRow glare sweep while tasks run. The trailing caption chevron is gone — the hover fill carries the affordance.

**Goal card.** Full goal text + inline 编辑, the progress bar now paired with the done/total fraction, and the recent-advance list, all on the official Menu surface.

**Task panel.** The filter row is color-dot capsules whose selected state takes a 14% tint of the member's own color (`--room-chip-color` inline custom property + `color-mix` — tinted fill, never an outline), with the ＋添加 trigger moved from the panel foot to the row's right end. Group headers are Linear's small-caps register (11px, 600, letter-spaced, uppercase, tertiary — the `text-transform` does the casing). Task rows: colored status icons (business-primary spinning half-ring for in_progress, tertiary empty ring for pending, filled success check for done, caption ring for cancelled), an ellipsizing title, a member chip (color dot + name on fill-l1), the 等谁 blocked tag, right-aligned tertiary status · relative-time, and the row-end 完成. Rows hover the interactive fill; a negative horizontal margin keeps glyphs optically aligned with the card padding.

**Completion beat.** Closing a task replays a restrained animation: the check pops (scale 0.6→1) and the done title's strike draws in across the text while the title dims — 240ms, under the 300ms brief, with a `prefers-reduced-motion` cutoff. The strike rides a background-gradient on an inner inline span so the line spans the text, not the flex-stretched row; rows remount on status change (`key = id:status`) so the CSS animation replays.

**Build finding — `composes` does not multi-class-export here.** The client bundle's lightningcss pass (`build/tsdown.client.ts`, `cssModules: { pattern }`) compiles `composes: capsule` into the stylesheet but exports `capsuleActive` as a single class, so the active capsule silently lost every capsule rule and fell back to the UA button border (2px outset) — a bug the A/B variants shipped with. The redesign avoids `composes` entirely: state rides `aria-expanded`/`data-active` attribute selectors on the one class. No package in the tree uses `composes` anymore.

## Alternatives considered

- **Keeping variant B as the default and polishing it** — rejected: the user rejected both variants on taste; parameterizing the loser further litigates a settled question. The redesign takes the official chip register (variant A's frame) as the skeleton and fixes the content hierarchy the A/B never touched.
- **Percent inside the progress ring** — rejected: a 14px ring fits no legible 3-digit label; the percent sits beside the ring in 600 weight, the ring keeps the arc as the glanceable signal.
- **Hiding the running sweep in favor of the runner chips alone** — rejected: the sweep is the room's established running idiom (ToolRow), and the brief kept it; the runner chips add *who*, the sweep adds *alive*.
- **Delaying the store mutation to animate the transition in-place** — rejected: the board is journal-driven; holding the close back for 240ms would fork the state timeline for a decoration. The `id:status` remount gets the same beat with zero state involvement.

## Consequences

- The collapsed row now answers three questions at a glance — how far (ring + percent), how much is open (count), who is on it (runner chips) — at the cost of the goal text sharing the row with the percent.
- Grouped rows repeat the member chip under their group header (the approved ASCII shows it); the redundancy is deliberate, the chip is the row's identity anchor when groups scroll.
- `tasks.summary.pending` / `tasks.summary.running` leave the locale dictionaries; `tasks.doing` joins them (both languages). The capsule spec's collapsed-row assertions moved from count strings to the percent + runner vocabulary, and the composer spec follows.
- The `composes` finding applies repo-wide: any future CSS Module state variant in a client bundle must use attribute selectors or explicit two-class composition in TSX, not `composes`.

## Testing

The 143-test suite stays green with assertion updates in `room-dock-capsules.client.spec.tsx` (collapsed percent/count/runner content, the card's `1/3` fraction) and `room-composer.client.spec.tsx` (`tasks.doing` key). Visual verification ran on the scratch :3199 instance over three Playwright rounds (scratch-screenshots/design-a-*.png): collapsed, goal card, task panel, running sweep + half-ring, completion beat, dark mode, and the no-goal guide state. Round 1 surfaced the `composes` UA-border bug; rounds 2–3 verified the fix and the seeded-room flows (goal set → add → close → advance record).

## Related

Supersedes [the chrome-variants note](2026-08-20-room-capsule-chrome-variants.md) (both candidates rejected by the user; the variant mechanism is deleted).
