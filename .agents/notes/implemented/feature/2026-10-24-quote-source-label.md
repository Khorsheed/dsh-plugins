# Agent Note: a quote names the content it came from

Status: implemented

## Problem

Quoting a passage from the 灵感空间 article pane produced the chip 「引用「<session title>」」: the quote menu labels every selection with the current session's display title, so an article quote named the conversation it was docked beside, not the article. Separately, the reader's globe translated the article body but left its title (the h1 and the header bar) in the original.

## Decision

- **Opt-in `data-quote-source` attribute.** `classifySelection` (quote) reads the nearest `[data-quote-source]` around the selection's range and carries it as `SelectionSnapshot.source`; the menu labels with `source ?? session title ?? fallback`, on every route (chip, side chat, contributed actions). It is plain DOM data, so it is not a package edge: a surface that never sets it, or a host without the quote plugin, behaves as before. Exported as `QUOTE_SOURCE_ATTR`.
- **The reader sets it on the detail root** to the title the reader sees, which is the translated one while a translation shows.
- **The title follows the body's translation.** In 译文 the h1 and header bar show the translation; in 对照 the h1 shows the original under it; in 原文 the original. The title rides the body's run: page memory → the host's sentence memory → the same Translator session. What the model learns joins the body's single persist batch; the stored-translation path (no Translator API) only reads memory.

## Alternatives considered

**A reader-side quote action with its own label.** Rejected: the built-in 「引用到当前会话」 row would still mislabel; the label belongs to the selection, not to one row.

## Consequences

- Entry records saved before this change lack the title: re-opening such an article costs one model call for the title alone.
- Any other content pane (a document preview, a canvas card) can name its quotes the same way by setting the attribute.
