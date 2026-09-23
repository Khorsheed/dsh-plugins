# Agent Note: canvas 0.4.7 — pasted rich text keeps its formatting, and the link view stops narrating itself

Status: implemented

## Problem

One user pass over the canvas surfaced four complaints, each with a screenshot:

1. **Pasting a rendered chat answer or web paragraph into a card dropped every mark of formatting** — the paste arms converted tables and nothing else, so a copy whose clipboard carried `text/html` landed as bare words (the user read it as "md 被清成文本"). The one exception a card could not express was exactly the case the surface exists for: keeping another surface's markdown.
2. **The link view narrated every gesture.** A permanent hint line under the stage, an empty-state explainer in the bar, and a toast per gesture — the screenshot caught「这张进到了「测试」」for a drag whose result was already on screen. Ten toasts covered gestures whose outcomes were already visible.
3. **Icons drifted from the host.** 追问 carried a bare `→` character, two "add" buttons used full-width ＋ as a glyph, the eraser had no icon at all, and the tab strip's × was the fill variant at a size that rendered as a smudge.
4. **Typography drifted too**: seven hand-picked font sizes (10.5/11/11.5/12/12.5/13/14.5) where the host ships a token ladder, and one `--dsw-font-mono` reference that never resolved (the real token is `--ds-font-family-code`, reached through `--dsw-font-markdown-code-block-small`).

## Decision

**A sixth paste arm: `formatted`.** `htmlToMarkdown` (`src/client/paste-table.ts`, pure, DOMParser-based) converts the markup flavor of a rich-text copy — headings, emphasis, strike, inline code, links (http/https/mailto only), nested lists, quotes, fences, rules, and tables; scripts and styles never survive. Two gates keep the module's founding rule ("mangling ordinary prose is worse than declining to convert"):

- **The honesty gate**: the conversion lands only when its own plain words match the clipboard's `text/plain` whitespace-blind exactly. A conversion that drops words the plain flavor kept is declined — losing content is the failure this module exists to avoid.
- **The no-op gate**: when the conversion equals the plain flavor byte-for-byte (plain paragraphs), the browser pastes natively and nothing is announced.

The arm boundaries moved with it: the table arm now fires only when the table IS the clipboard's payload (a spreadsheet's TSV double, or a lone `<table>`), so a table mid-prose converts with its prose instead of eating it; the page arm narrowed to whole documents (doctype/`html`/`head`/`body` openers), so a copied chat answer into an empty card becomes markdown instead of a sandboxed HTML card; a fragment that fails the honesty gate still falls back to the page arm (the iframe renders it) — beats losing the words. `words` keeps exactly one case: a whole document into a card that already holds prose.

**The link view's rule is now: a result the stage already shows is never also announced.** The hint row is gone (discoverability was always carried by the hover ports and their tooltips); the toasts for linking, marquees, lane enter/leave, lane moves, lane adds, expansion toggles and clears are gone; the bar's empty state reports the board's own totals (live data, not a hint) and its selected state reports the send set without appending the totals; 取消选择 hides itself when there is nothing to clear. One toast survives: 删掉这条线, because deleting a 1.6px line from a button at the bar deserves the confirmation that the cards stay. See [the link-view note](2026-09-23-canvas-link-view.md) for the surface this quiets.

**Icons and type ride the host.** 追问's `→` is the host's `IconRightUpOutline14` (the same open-elsewhere glyph the attachment link wears), shared by both comment threads through a new `follow-up.tsx`; the two full-width ＋ buttons carry `IconPlusOutline16` with text-only labels (加一个 / 新分区); the eraser and 撤一笔 drew package-owned glyphs (`icons.tsx`, the message-tools supplement convention — 16 viewBox, `currentColor`); the tab strip's × stayed the host's `IconCloseFill14` (what the host's own TabPanel uses) at a legible 12px; the pen/eraser cursors now have a dark-theme variant (they were white-on-nothing on dark fields). All 80 font declarations moved to the `--dsw-font-*` ladder (10.5/11→xxxs-11, 11.5/12→xxs-12, 12.5/13→xs-13, 14.5→s-strong-14; 500-weight rules to the `*-strong-*` variants; deliberate local line-heights kept). The phantom `--dsw-font-mono` reads `--dsw-font-markdown-code-block-small` now.

## Alternatives considered

**Turndown (or any general html→markdown library).** Rejected: a general converter answers "what does this HTML mean" for every pathological page on the web, which is a bundle of heuristics we would then have to tame; our converter answers it for clipboard fragments, and the honesty gate lets a wrong answer decline itself. No dependency, and the conservative default lives in the comparison, not in the converter's cleverness.

**Keeping the per-gesture toasts as teaching text.** The link view is the board's second face, and a face you have to read about before touching has already failed; the ports appear on hover and say what they do, the wires are visible, and the bar reports the one thing gestures cannot show (what will be sent). The teaching copies were written before the surface could show any of that.

**Matching the host's radii and spacing to the pixel.** Rejected as scope: the host itself hardcodes radii (there is no `--dsw-radius`), so the ladder claim is about type and color, where tokens exist. Geometry stayed local.

## Consequences

- The formatted arm costs one DOMParser pass per rich paste (unmeasurable at paste rates) and the converter's maintenance; it buys the surface's founding promise (a card accepts what you copied) for the most common copy there is.
- The honesty gate means some legitimate conversions decline (a clipboard whose plain flavor disagrees with its markup — rare, and always falls back to the words). That is the intended failure direction.
- Nine locale keys and the hint left the dictionary; `paste.formatted` arrived. The link spec's toast assertions became visual assertions (the wire appears, the badge flips, the button retires) — a better spec of the same surface.
- 0.4.7 carries all of it. The link-view note's testing inventory is updated in place for the marquee line; every other behavior that note records is untouched.
