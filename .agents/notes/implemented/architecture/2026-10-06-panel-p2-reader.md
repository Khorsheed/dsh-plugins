# Agent Note: panel spec P2 — compact inspiration space (dsh-reader)

Status: implemented

## Problem

On a phone the inspiration space showed the desktop sidebar layout at full width: six header icons in one row (refresh, filter, sort, history, settings, add), a search field always taking its own row, one notice row per incomplete source, and grey-filled bordered cards whose title and summary each reserved two lines (a one-line title left a block of empty space under it). The article detail had five icons beside its title, and its body and headings were fixed pixel sizes, so the mobile package's larger reading size never reached them.

## Decision

- **The pane sits in the kit's `PanelRoot`** (a thin `ReaderPane` wrapper around the existing body), so `@container dsh-panel (max-width: 560px)` rules apply and the body reads the compact flag from context. jsdom has no layout, so existing tests stay on the wide path.
- **Compact wall header** is a `PanelHeader`: 灵感空间 plus the unread count; search and add pinned; refresh, sort (labelled with the current order), the wall translation switch (when offered), recently read and subscriptions in ⋯. The search row folds behind the search icon (shown while a query is set; closing it clears the query). The filter panel and the sort menu are now built once and placed by whichever header is showing; on the compact header they hang from a zero-size anchor at its right edge.
- **Filter chips** (compact only): All, Unread, Feed, Saved link, the reader's own tags, and "Filter…". Every chip but Unread writes the search query (the wall's one narrowing channel), so pressing a selected chip clears it and All clears everything, Unread included. By-source and hide-duplicates stay in the two-level popover that "Filter…" opens — a source list grows without bound, which a chip row cannot hold. "Fetched" was in the mockup but is not a filter dimension the wall has; not added.
- **Cards become list rows** on a compact panel: no fill, border box or radius, one hairline between entries, the source tile and chevron dropped, unread as a dot before the source name, title at the title token (600), summary at the body token in the secondary colour (two lines), meta at the meta token, and **no reserved lines** — the two-line reservation exists so a translation swap cannot shift the wide grid; a single column has no grid to shift. Tags, link-only, the fetch pill and the add-tag button share one 26px chip geometry, each keeping its own ink; the add-tag button is always visible (a touch screen has no hover).
- **Incomplete sources fold** into one line, "N sources incomplete · Show", when there are several — at every width, since the stack grew with the subscriptions on the desktop sidebar too.
- **Compact detail header**: back, no title, the translation control (globe + view caret) through the kit's new `PanelHeader.extra` slot, and copy link / open in browser / delete as ⋯ rows. `extra` is a compound control that takes no slot from the icon budget. The bar carries no title (coordinator review, 10-06): the article's heading sits right below with its source and date in the kicker, so either the article title or the source name in the bar would say it twice; the wide bar keeps its title, which there sits beside more controls and is not followed by a large heading in view.
- **Body text takes the primary ink** at every width (coordinator review, 10-06): the reading body was `label-secondary`; it is now `label-primary`, with blockquotes and figure captions keeping the secondary ink — text that comments on the body. Checked in both themes on the fixture.
- **Reading sizes follow the shared token** with the reader's own desktop sizes as fallbacks: body `var(--dsh-panel-text-reading, 13.5px)`, h1/h2 at 1.11× the body (15px on desktop, ~19px on a phone), h3/h4 at the body size, the article title `max(17px, 1.3×body)` (17px desktop, 22px phone). The Chinese/Latin line heights (1.78 / 1.66) are kept rather than replaced by the shared 1.7: that split is deliberate typography, and both already exceed the shared value's intent.
- A repo-only fixture (`packages/dsh-reader/examples/compact`, port 8876; `?w=`, `&theme=dark`, `&touch=1`) renders the real pane over an in-memory host face for screenshots. The package's `files` does not include `examples/`.

## Alternatives considered

- **Put the chip row on wide panels too.** Not done: the wide header already holds the filter popover, and the desktop wall was not part of the complaint; one narrowing surface per layout.
- **Drop the two-line reservation everywhere.** Rejected: the wide grid would jump whenever wall translation swaps a field.
- **Read `--dsh-panel-reading-line-height` for the body.** Rejected for now: it would flatten the per-language leading on a phone; revisit if the user finds phone leading too loose.

## Consequences

- Wide layouts are unchanged apart from the folded incomplete-source notice and the reading sizes now reading the token (identical values without the mobile package).
- On a compact panel the wall translation switch is in ⋯; the view caret (translation only / side by side) exists only on the wide header.
- Known, pre-existing: the detail tag row and the tag picker's rows share the class name `tagRow`, so the detail tag row inherits the picker's 8px side padding (visible at every width). Left for a separate fix.
