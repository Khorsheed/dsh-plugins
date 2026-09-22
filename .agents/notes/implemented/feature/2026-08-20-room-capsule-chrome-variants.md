# Agent Note: room — dock capsule chrome variants (A chip register / B text row)

Status: implemented

English | [中文](2026-08-20-room-capsule-chrome-variants.zh.md)

## Problem

The dock's dual capsules (goal + tasks) drew "设计感差" from their first reviewer. The collapsed row was a one-off register — tip-surface pills with unicode ◐/▦ glyphs and no official counterpart — and the expanded card was the old strip's TodoPanel port, a third surface material beside the official Menu the room's own @-completion card already used. The fix needed a visual decision, and that decision is the user's to make: two candidate chromes had to exist side by side, comparable in the running product.

## Decision

Both variants ship in one bundle, keyed off the root section's `data-variant` attribute (`RoomDockCapsules.tsx`'s exported `CAPSULE_VARIANT` constant picks the default — `'a'` while the choice is pending; the attribute flips live in DevTools for A/B screenshots). One DOM, zero behavior change: filtering, add, edit, close all untouched.

**Variant A — the official chip register.** The capsules take the model-selector trigger's language (ui-model-selection `ModelSelect.module.css`): 28px rounded (r24) chip, transparent at rest, the standard interactive hover fill, 13/20/500 secondary label, caption chevron rotating 180° open. The ◐/▦ leading icons stay here as the chip's icon slot.

**Variant B — the light text row.** No chip chrome at all: tertiary 12/18 text in the compaction/dim-line register, led by a 6px state dot (business-primary while the capsule's concern is live — goal set / tasks running — caption tone at rest) and the same chevron; a hover-only fill floats the background. The leading icons hide in this variant.

**One shared panel.** Both variants expand into the official Menu surface — `--dsw-specific-menu` background, r12, inverted hairline border, shadow-lv3 — the material the room's @-completion card and the model selector's dropdown already use, replacing the TodoPanel-port tip card.

**A restrained running cue.** While tasks run, the task capsule sweeps a fixed-width glare band (theme background at 60%, `color-mix`) off-left to off-right on a 2.6s ease-out loop with a 10% end hold — the ToolRow pattern verbatim — with a `prefers-reduced-motion` cutoff that drops the band and the chevron transition.

## Alternatives considered

- **Shipping only variant A** (the official register, decided unilaterally) — rejected: the complaint was taste-level, and the cheapest way to settle taste is a real A/B in the product; the `data-variant` switch costs one attribute and keeps both candidates buildable until the user picks.
- **Two component trees behind a prop** — rejected: duplicated JSX drifts between variants on the next behavior change; one DOM with variant-keyed CSS keeps behavior single-sourced (the structure assertions in the capsule spec run unchanged).
- **A bespoke running animation (pulsing dot, progress shimmer on the bar)** — rejected: the harness already owns a running-glare idiom (ToolRow); borrowing it keeps the room inside the product's motion vocabulary instead of inventing a second one.

## Consequences

- The default chrome is variant A; flipping to B is a one-constant change (or a live attribute set), and deleting the loser later is a pure CSS removal plus the constant.
- The expanded card's material change applies to both variants — whichever capsule chrome wins, the Menu-surface panel stays.
- The unicode ◐/▦ icons survive only in variant A; if B wins they leave with the variant block.
- The 143-test suite needed no assertion changes: the variant system adds attributes and decorative spans only, and every existing query (roles, text, `[class*=_glyph] svg` counts) reads through them.

## Testing

The existing capsule client spec (`room-dock-capsules.client.spec.tsx`, 10 tests) pins the unchanged behavior against the new DOM. Visual verification is manual: Playwright screenshots of both variants collapsed/expanded on the scratch instance (variant-a-*.png / variant-b-*.png screenshots were local scratch and have since been cleared), taken against the live :3199 room session.

## Related

Superseded by [the quest-bar redesign note](2026-08-22-room-quest-bar-redesign.md): the user rejected both candidates, and the `data-variant` mechanism (this note's Decision) is deleted. The Menu-surface panel, the chip register, and the running sweep survive into the redesign.
