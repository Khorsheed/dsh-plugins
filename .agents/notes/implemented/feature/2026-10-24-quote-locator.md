# Agent Note: a quote tells the model where the content lives

Status: implemented

## Problem

A passage quoted from a file preview arrived as `—— 引用自「<session title>」`: the shared content pane declared no source, so the quote named the conversation beside it. The model learned neither which file the text came from nor where to find it. Quotes taken from the conversation itself carried the session title too, which told the model nothing it did not already know.

## Decision

- **`data-quote-ref` beside `data-quote-source`.** `classifySelection` reads the locator only off the element that declared the source, so a label and its locator always come from the same surface. A located quote's attribution is `—— 引用自「<name>」（<ref>）` (en `— quoted from “<name>” (<ref>)`); the chip keeps the short name; the chip-click preview ends with a 位置 row holding the locator, so the user sees what the model receives. The side-chat route appends `位置：<ref>` to the ref text. Contributed actions receive `ref` on the target.
- **The shared content pane declares both**: the file's basename and its absolute path (`displayPath ?? path`). Every consumer of `ContentPane` (local-files, file-preview, worktrees) inherits it.
- **Absolute paths**, by the user's call on 2026-10-24: unambiguous across sessions and working directories; only the model and the preview card show them.
- **Sourceless quotes name nothing.** A selection without a declared source is labeled by an excerpt of the quote (16 characters, then `…`), its attribution is the bare `—— 引用`, and the sent card renders the body without a source row. The session title stays only where it carries information: the side-chat context label and the contributed-action target.
- **Card parsing** recognizes three forms per locale: located (tried first, so a locator never reads as part of the label), plain, and bare. Messages sent before this change keep their cards.

## Alternatives considered

- **Line numbers in the locator.** Rejected for now: a rendered Markdown selection does not map back to source lines reliably, and the path plus the quoted text is enough for the model to grep.
- **No attribution line at all on sourceless quotes.** Rejected: the transcript card needs a closing marker to recognize the block.

## Consequences

- Other content surfaces (canvas cards, library books, datasets, transcripts, the reader's original link) still need to set the two attributes; until they do, their quotes fall to the sourceless form.
