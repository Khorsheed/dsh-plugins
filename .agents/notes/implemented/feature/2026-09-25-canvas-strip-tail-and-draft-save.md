# Agent Note: canvas 0.4.8 — the strip's ＋ tail leaves the scroll box, and filing a card takes you back to the board

Status: implemented

## Problem

A second user pass over the canvas surfaced four complaints, three of them with screenshots:

1. **"点新增画布没反应" — the ＋画布 switcher opened a menu nobody could see.** The reproduction (0.4.7, right sidebar in fullscreen, the user's own layout) shows the trigger toggling `aria-expanded` while nothing paints. The a11y tree holds the menu; the pixels do not. Measuring the open menu found the trigger's box at y=−68 while the strip sits at y=38: the `position: sticky` tail inside the `overflow-x: auto` scroll box mis-anchors the dropdown's containing block (a sticky-inside-overflow quirk, layout-dependent — the narrow docked sidebar happened to compute it correctly, which is why earlier hand-tests passed), and the strip's overflow then clips whatever the mis-position leaves. The user reasonably concluded the button was dead and suspected a design conflict between board tabs and card tabs.
2. **The strip's × read smaller than every glyph beside it.** The `IconCloseFill` artwork's cross spans only 9/16 of its viewBox (the outline family spans ~11–12/16), so at the rows' uniform 12px it was visibly the smallest icon on the row.
3. **Filing a new card left the writer on the emptied draft tab**, with a toast announcing a card that lived somewhere else. The original rationale ("closing the row would take the toast with it") was stale — the toast moved to the tab's root when the host's own Toast arrived in 0.4.x, so the row's closure costs the toast nothing. The same pass asked for ⏎ to file the title-like quick card.
4. **铅笔/橡皮's selected state was the dark `primary` capsule** — the vocabulary of an action button, worn by what is a mode choice, two centimetres from the page's own mode switch (渲染/源码/分栏) that says the same thing with quiet tokens.

## Decision

**The tail is a sibling of the scroll box, not a passenger in it.** `TabStrip` restructured to a frame (owns the fill and the bottom rule, clips nothing) containing the scroller (rows only) plus the static tail. No sticky anywhere — a control that cannot scroll away by construction needs no sticky — and no overflow ancestor for the dropdown ever again. The scroller's `padding-bottom: 1px` plus its own −1px keeps the active row's cover painting over the frame's rule from INSIDE the clip box (overflow clips at the padding edge). Verified A/B on one instance: 0.4.7 = invisible menu in fullscreen; 0.4.8 = menu, form, and create all work in the same seat.

**The × is the host dock's own answer.** `IconCloseFillRegular` at 14 — exactly what the host's `TabPanel.tsx` renders for the same glyph. (The rc.1 icon line ships both Regular and Medium; prod runs 0.1.7-rc.1.)

**铅笔/橡皮 is the page's second segmented control.** Same tokens as the ModeSeg above it (`bg-layer-1` group, `border-l1`, pressed = `bg-layer-2` + `label-primary`); 撤一笔/清空 stay host `Button` ghosts because they are actions, not modes. The specificity fight with `Button.module.css`'s variant rules was avoided by not using the variant system for a toggle at all.

**A filed card takes you home.** `saveDraft` now closes the draft row and activates the board it filed to; the root-mounted toast survives the row. `CardTextarea` grows an `auto-enter` chord: bare ⏎ submits while the draft is one line (the title-like quick card the user described), becomes a newline the moment a `\n` exists, and ⌘⏎ always submits; Shift+⏎ is the explicit newline on one line. The hint under the box names the chord that currently works (`detail.createHint` / new `detail.createHintMulti`).

## Alternatives considered

**Redesigning the tab model (the user's own question: do board rows and card rows conflict?).** Not a conflict — the model (one strip, row kinds derived from their subject) is what round-3 item ⑥ asked for and the surface's drills depend on; the dead click was a layout bug wearing a design question's clothes. The fix is structural, and the strip's grammar is unchanged.

**Anchoring the dropdown with `position: fixed` or a portal.** Rejected: it patches the symptom while keeping the fragile arrangement (a floating layer inside a scroll box) that produced it; moving the tail out is smaller, and removes the trigger-scrolls-away failure mode too.

**⏎ everywhere in the draft.** Rejected: the composer is a markdown editor (multiline prose, pasted documents) before it is a title box, so a bare-⏎ submit needs the one-line condition. The condition is honest about what the gesture optimizes: a quick card, not an essay.

## Consequences

- The switcher's outside-pointerdown listener, menu positioning, and create flow needed no changes — only the geometry that hosted them was broken.
- `strip.client.spec.tsx`'s "row STAYS" assertions became the return-to-board behaviour plus the chord matrix (one-line ⏎, two-line ⏎, Shift+⏎, ⌘⏎, IME guard); 472 tests green.
- One dev-ops lesson that cost an hour: `dsh plugin install` on a profile whose `pnpm-workspace.yaml` carries `overrides` resolves the override, not the `link:` in package.json — a dev instance needs BOTH spots pointed at the checkout (and a stale lockfile pins the tarball past both). Version-bumping the package also defeats the store's name@version reuse.
- 0.4.8 carries all of it; README's card-editing bullet names the new gestures in both languages.
