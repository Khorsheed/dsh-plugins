# Agent Note: Chapter Markdown renders through raw-offset inline tokens

Status: implemented

## Problem

The chapter reader showed everything except headings as literal paragraphs, so quotes, strong text and horizontal rules were visible as source characters. Replacing that with a normal Markdown renderer would lose the mapping between rendered text and the raw chapter, breaking selection comments and existing highlighted feedback whose anchors are raw offsets, quotes and context.

## Decision

- `ChapterMarkdown` renders a deliberately small safe subset: headings, paragraphs, blockquotes, strong and emphasized text, inline code, unordered and ordered lists, and horizontal rules. Raw HTML stays literal text; no HTML enters the DOM and no renderer dependency is added.
- Every selectable inline token carries its raw `start` and `end`. Markdown delimiters are not displayed but remain in the source string, so selection across formatted and unformatted text still returns the exact raw quote and offsets.
- Feedback ranges are located in the raw chapter and intersected with each token. A highlight may span tokens without changing the selection mapping or the `data-idea-id` jump target.
- `ChapterReader` delegates to this renderer. Empty chapters, the first-title omission, editing, quote-source metadata and read-only behavior remain in the reader.
- The host's published `MarkdownText` cannot supply this mapping, and its parser source is not present in the published artifact. The implementation therefore owns only the required subset rather than importing an unsupported internal module.

## Alternatives considered

- **Use the host MarkdownText component.** Rejected: its semantic GFM output does not expose raw offsets, so `chapterSelectionFromRange` cannot reconstruct the original quote.
- **Deep-import the host parser.** Rejected: the installed npm artifact contains no parser source. Such an import would work only in a source checkout and fail for community installs.
- **Render arbitrary HTML or add a full Markdown dependency.** Rejected: chapter feedback needs source-aware rendering, not a larger unsafe or generic pipeline. The supported syntax stays explicit and tested.

## Consequences

- Common author notes and separators render correctly while existing comments keep working across quotes, strong text, code and paragraph boundaries.
- The subset is intentionally smaller than full GFM. Links and other unsupported constructs remain literal text rather than acquiring partial, offset-breaking behavior.
- Tests cover rendering, HTML text fallback, highlights and raw selection offsets. The full novel suite passes 37 files and 284 tests.
