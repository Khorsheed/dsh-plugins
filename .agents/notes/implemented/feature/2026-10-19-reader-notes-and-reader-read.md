# Agent Note: reader notes, discussing them, and the reader_read tool

Status: implemented

## Problem

The reader (灵感空间) let the reader read and quote an article, but nothing they thought about it survived: no excerpt could be kept, no comment written, and a discussion with the model started from whatever text was pasted into the draft. The model itself could not read the article — the host never parses an article (the browser half extracts it), and a feed entry's text never reaches the host at all. This is phase P1 of `proposals/active/2026-10-19-reader-notes-feynman.md` (notes, discussing them, and a way for the model to read the article); the conclusions written back into notes and the 「让Agent考考我」 check come in P2.

## Decision

- **Notes are the reader's own state, in their own file.** `src/notes.ts` keeps `notes.json` beside `state.json` under the reader's state root: per article, the excerpts (`n1`, `n2`… — never reused), each with an optional comment, and the conversations that discussed it. Writes are atomic (temp file + rename) and serialized through one promise chain; an unwritable root degrades to memory, a notes file that does not parse is refused rather than overwritten. Notes are deliberately NOT annotation fields in `state.json`: annotations are shaped around the body cache (`boundAnnotations` evicts by body, `normalizeAnnotations` drops what it does not know), and a note must outlive both.
- **An excerpt is anchored by its original text.** `ReaderNoteAnchor` = block (the reading position's unit: top-level children minus translation reveals) + character offset + the quote. A selection made in the translated view stores the ORIGINAL of every sentence it touched as the quote and the selected translation beside it. The quote is the source of truth: a refetched article is searched again and a note whose text is gone says so instead of guessing.
- **Highlights never touch the body's DOM.** `translate.ts` splits the body's text nodes into sentence spans; wrapping excerpts in `<mark>` would fight it on every view switch. `src/client/notes.ts` paints through the CSS Custom Highlight API instead, recomputing ranges after each rebuild: exact text in the original view, whole translated sentences (and the original lines beside them) in the translated view.
- **Ways in.** 「记笔记」 joins the quote plugin's selection menu through `ctx.quoteActions` (probed at apply; shown only while the selection is inside a reader article, routed to the pane that owns it), and the detail view's foot carries the same button for compositions without quote. The note sheet rises inside the pane (no fixed positioning), one layout for every width.
- **The notes face.** The detail view switches between 「正文」 and 「笔记 n」 (`UnderlineTabs` from the panel kit). The article stays mounted but hidden while notes show — its segmentation, translation and reading position live on that subtree. Notes can be edited, deleted, and jumped back to; 「带着笔记讨论」 merges the chosen notes (¶, id, excerpt, comment, article id) into the draft — read-merged, never overwritten, never sent — and records the conversation on the article, with 「回到会话」 through ui-workspace's `openSession` when it exists.
- **The model reads a snapshot.** When an article body renders, the browser parses the stored markup (never the screen, which may be translated) into one string per block and hands it to the host (`snapshotEntry`); `snapshots/<sha1>.json` holds it, loose snapshots (articles with no notes or discussions) pruned to the 30 most recent. The new `./tool` composition entry registers `reader_read`: no arguments reads the article opened last; `entry` resolves an id, a link or part of the title; the text is ¶-numbered and paged at 60k characters (`from`), followed by the notes. Reading an article in a conversation records that conversation on it. The patch mounts the tool row at the profile root (every session, the 2026-10-19 decision).
- **Notes' types live in `src/notes-types.ts`**, re-exported through `./types`, because the Typert generator requires Remote boundary types on a public type subpath and the browser half must not import the store's `node:` modules.

## Alternatives considered

**Notes as fields on `state.json` annotations.** Rejected: every normalizer and evictor there is keyed to the body cache, so each would need an exception for notes, and the in-flight `feat/preset-visibility-refresh` branch is reworking `store.ts` — a separate file keeps the two changes apart.

**`<mark>` elements in the body.** Rejected: it mutates the subtree `translate.ts` owns and breaks its restore-to-original guarantee; the Highlight API costs nothing but a browser that supports it (others simply show no highlight).

**Let the model fetch the article itself (`web_fetch` on the link).** Rejected: it refetches what the reader already has, misses feed-published text and rendered fetches, and cannot number paragraphs the way the notes do.

**Snapshot the screen's text.** Rejected: the screen may show a translation; the model must read what the author wrote, and ¶ numbers must match the anchors.

## Consequences

- A note survives body eviction, refetches and translation switches; its excerpt is self-contained text.
- The model can read any article the reader has opened (and only those) without the reader pasting it; an article never opened answers that the text is missing.
- One more file and directory under the state root (`notes.json`, `snapshots/`); snapshots are bounded (400k characters each, 30 loose ones).
- Browsers without the Highlight API show notes without the in-text highlight.
- 「记笔记」 appears in the quote menu only when quote applied first; otherwise the foot button is the way in.
- New optional peers: `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-agent` (the tool row only).
