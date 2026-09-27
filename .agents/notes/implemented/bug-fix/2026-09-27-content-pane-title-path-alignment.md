# Agent Note: The content pane's basename/path alignment (the back control hangs in the pane inset)

Status: implemented

English | [中文](2026-09-27-content-pane-title-path-alignment.zh.md)

## Problem

The shared content pane's detail view draws a two-line title bar: the basename with its language chip, then the resolved path, with the back control leading the first line. Pixel-measuring the pane as rendered on the 3080 instance (the owner's screenshot, 2026-09-27) put the path line 24px from the pane's left edge and the basename at 56px — exactly the control's 24px plus the title row's 8px gap. One header whose two rows do not share a left edge; the owner's feedback was to put them on one edge with no such gap.

The obstacle is geometric rather than stylistic: a leading control that stays in the flex flow always pushes what follows it right by its own width plus the gap, so a control in front of the basename can never let the basename start on the path line's edge. Trimming padding only moves the two rows together, so every candidate had to choose where the control lives.

## Decision

One token owns the line: `.root` in `ContentPane.module.css` declares `--pane-inset: 24px` (with `--title-gap: 8px`), and the title bar's padding, the content-search row, the notice / script-confirm margins and both body scroll paddings consume it, so no chrome row can drift off the pane's inset on its own.

The back control occupies that inset instead of sitting in front of the basename:

```css
.titleBar:not(.headerEmbedded) .back {
  margin-left: calc(-1 * var(--pane-inset));
  margin-right: calc(-1 * var(--title-gap));
}
```

The button's border box lands on 0–24px, the cancelled right margin puts the basename at 24px — the path line's edge, the search row's and the body's — and the visible breathing room between chevron and basename is the glyph's own centering inside its 24px button. The row gap before the action cluster is untouched, and no markup, prop or translation key changed.

Embedded panes (`embedded` → `.headerEmbedded`, the worktrees commit detail) keep the plain flow row: there the inset belongs to the consumer's chrome and the kernel cannot measure it, so a negative margin would push the control out of the pane.

## Alternatives considered

**Move the back control into the right-hand action cluster.** It does put both rows on 24px, but "return to the artifacts list" would leave the corner the gesture is expected in, with only a tooltip carrying the meaning.

**Keep the control leading and indent the path row to the basename (both at 56px).** Aligns the rows by pushing both further from the pane edge; the ask was flush-left, without the gap.

**Hang the control 32px into the padding so the basename keeps its 8px gap.** 32px exceeds the pane's 24px inset, so the button and its hover pill would overhang the pane's left edge.

**A new prop, or a caller-owned title row for the aligned variant.** The geometry is CSS's job; the pane's prop contract stays as it is and every consumer gets the fix by rebuilding.

## Consequences

Every non-embedded pane now puts the basename, the path, the search row and the body on one 24px line, the inset is a single token, and the shared kernel's consumers (ui-file-preview's artifacts detail, local-files' workspace view, worktrees' commit detail) pick the fix up with no API change.

Two costs. The back control's 24px hit area now abuts the pane's left edge, so its hover pill's left corners sit against it. And the embedded pane is deliberately not covered: worktrees' commit detail still starts its basename one control right of its path line, because that pane's inset belongs to a container the kernel cannot measure — the fix shape there is a consumer-declared overhang token, not another negative margin.

Testing: the geometry is CSS-only and jsdom has no layout engine, so `content-pane.client.spec.tsx` still pins only the control's presence and click behavior, and no spec asserts pixel positions; acceptance for this change is therefore the pixel measurement itself (both rows on the pane's 24px inset, the control's box at 0). CSS-module hashing keeps the `:not(.headerEmbedded)` guard intact in each consumer's bundle (checked in the built `lib/client.js`), and the touched packages' builds and tests are green.
