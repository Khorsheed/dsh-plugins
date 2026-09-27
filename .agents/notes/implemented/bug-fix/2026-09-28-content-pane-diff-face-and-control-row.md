# Agent Note: The content pane's diff face gets a body, and the path row's controls get a group

Status: implemented

English | [中文](2026-09-28-content-pane-diff-face-and-control-row.zh.md)

## Problem

Two GUI reports on the shared content pane (owner, 2026-09-28), both about the pane's own chrome rather than any consumer's content.

**The change-history face had no body chrome at all.** The kernel rendered a caller's `diffView` straight into `.body` — a flex column with `overflow: hidden` and no padding — while the content face gets `.previewScroll` (`padding: 10px var(--pane-inset)`, `overflow: auto`, `scrollbar-gutter: stable`). A consumer's history view therefore rode the pane's left edge (x=0) while the title, path and search rows all sit on 24px, its diff card went full-bleed, and its stepper jammed its top border against the header rule — measured ~1.5 CSS px above versus ~20px below, the asymmetry the owner reported as "间距很奇怪". Worse, nothing scrolled the face: `.body` clips, so a diff taller than the pane was silently cut off (reproduced by rendering the built CSS in headless Chromium: 40 diff lines in a 560px pane, no scrollbar). The consumer's own `.historyScroll` (`padding: 10px 12px; overflow: auto`) had survived the kernel merge only as dead CSS.

**The path row's trailing controls read as one accidental four-button cluster.** `.viewControls` was referenced in the JSX but never defined in `ContentPane.module.css`, so the span rendered with no class at all; its two `inline-flex` groups (改动/内容 and 预览/源码) then laid out in an inline formatting context — no gap between them, and baseline alignment between boxes of different heights (22px pills beside a 24px segmented control).

## Decision

One face, one body. `ContentPane` wraps the diff slot in `.diffScroll` (`flex: 1; min-height: 0; padding: 10px var(--pane-inset); overflow: auto; scrollbar-gutter: stable`) and marks the body `.bodyEmbedded` when the pane is embedded, where `.bodyEmbedded .diffScroll` drops the horizontal padding — that inset belongs to the consumer's own container. The face keeps an offset of its own in the existing per-(session, path) scroll memory under a `\0diff` key, so toggling 改动 ⇄ 内容 never trades one face's position for the other's.

The row gets its group back: `.viewControls` is defined (`display: inline-flex; align-items: center; gap: 8px; flex: none`) and the face switch takes the segmented control's metrics (`.viewButton` 24px tall, `0 10px`, radius 6 — matching `.segButton`), so the two groups read as two sibling controls instead of one cluster at two heights.

The consumer's stepper becomes quiet: `.stepper` loses its border, background and pill padding, and the arrows become 20px icon buttons (`‹ … ›`, tertiary at rest, hover pill, disabled at the chain's ends); the dead `.historyScroll` rule is deleted. With the face supplying the inset and the scrollport, the diff card is the only surface inside it — a second bordered pill above the card read as double chrome.

## Alternatives considered

**Give the consumer its own wrapper (revive `.historyScroll` in `FilePreviewTab.module.css`).** Smaller blast radius, but it leaves worktrees' diff face clipped and unpadded, duplicates the inset constant into every consumer, and keeps the kernel's two faces asymmetric for no reason.

**Keep the bordered pill and only fix the padding.** Declined by the owner on the rendered comparison: the diff card is the face's only surface, so a pill above it competes with it.

**Draw a full-width history bar instead** (the pill stretched to the card's width, arrows at the ends). Also offered, also declined in favour of the quiet inline row.

**Move the face switch (改动/内容) out of the path row** — a tab strip of its own, or the row's leading edge. Still open: this change settles the grouping and the metrics only; the placement question stays with the owner, and a tab-style treatment would be a separate decision.

## Consequences

Every non-embedded pane now draws the same body on both faces: the history view sits on the pane's 24px line and scrolls. Worktrees' tab-level detail pane (not embedded) picks up the same inset and scrollport, and its embedded commit pane gains the scrollport with no double padding. Scroll offsets are per face.

Costs: the diff face now reserves a stable scrollbar gutter (the content face already did), and the stepper's arrows lost 2px of hit area (20px, still at the official icon-button size) to read as quiet controls.

Testing: the touched packages' suites are green (`ui-content-preview` 55, `ui-file-preview` 79, `worktrees` 90, `local-files` 35), and the kernel spec still pins the diff slot's presence and its toggle. Geometry is CSS-only — jsdom has no layout engine — so acceptance is a pixel measurement against the built CSS rendered in headless Chromium: basename, path, stepper and diff card all start at 24px, the stepper's top gap is 10px, an overflowing diff shows a scrollbar, and the two control groups are separated by 8px at equal height.
