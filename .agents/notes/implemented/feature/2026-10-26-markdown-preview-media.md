# Agent Note: Images and local links in the markdown preview

Status: implemented

## Problem

The file surfaces' markdown preview showed a README's screenshots as raw text: `<img src="…" width="640">` printed literally, and so did `<p align="center">`. Local images (`![](docs/shot.png)`) showed only their alt text, and local links (`[English](README.en.md)`) were plain words. READMEs are the documents these panels show most often, so the rendered face lost exactly the parts that make it worth reading.

## Decision

The shared content pane fixes all three in its rendered face only. The source face and the editor keep the file's own text.

- **HTML media → markdown** (`markdown-media.ts`, `rewriteHtmlMedia`): before parsing, `<img>` becomes `![alt](src)`. An `<a href>` whose content is then plain markdown becomes a markdown link (so a linked image stays linked). The alignment wrappers `<p>`, `<div>`, `<center>`, `<picture>` and `<source>` are dropped, and lines that held only tags are emitted flush-left so HTML indentation cannot turn into an indented code block. Bare `<a>`/`</a>` lines of a multi-line anchor are dropped, so the image still shows. Nothing inside code is touched: fences, indented code blocks and inline code spans pass through, so a README that documents an `<img>` tag still shows the tag. Every other tag stays literal, as the official renderer intends.
- **Local images**: `ContentPaneProps.resolveImage(path) => Promise<url | undefined>`, where `path` is the destination resolved against the document's directory in the surface's own path space (`resolveDocPath`). `MarkdownDocument` hands the official renderer a `pathImages` resolver. The first ask for a path schedules the surface's read outside render and answers "not yet" (alt text). The answer lands in a cache keyed by (document path, read content), so a reload re-reads, while draft keystrokes and the surfaces' per-render closures do not.
- **Local links**: `ContentPaneProps.onOpenFile(path, { line })`, routed through the official `MarkdownDelegateProvider.openFile`.
- **Surfaces**:
  - local-files reads images through `readFile`, which returns a data URL, and opens links by selecting the file.
  - worktrees reads repo-relative images through `readRepoImage`, but not on a commit's content, which would borrow today's working-tree screenshot. Its links keep the current segment (a commit's README opens its sibling at that commit) and land on the content view. Absolute destinations are left alone.
  - file-preview's `read` already answers an image path with its image route; the pane absolutizes it. Its links select through the list's recorded spelling, so a file the agent touched keeps its change history.
- **Old hosts**: `ui-primitives` is a platform module, so it is the host's own copy at runtime. `MarkdownDelegateProvider` (2026-09) is probed and skipped when absent, which leaves local links as plain text. `pathImages` (2026-09) is a prop an older `MarkdownText` simply ignores.

## Alternatives considered

**Parse HTML (rehype-raw plus a sanitizer).** Rejected. The official renderer deliberately keeps HTML out of its pipeline, and the kernel renders through that component rather than owning a renderer. A text rewrite of a closed vocabulary keeps the same safety: everything it emits is markdown the renderer already sanitizes.

**Resolve images in the surfaces before rendering.** Rejected. It means each surface parses markdown to find destinations. Answering the renderer's own `pathImages` callback means the renderer decides what is an image, reference-style images included, and the kernel only caches.

**Show working-tree images for a commit's content in worktrees.** Rejected. A historical README would show today's screenshots without saying so. The alt text is honest.

## Consequences

- READMEs render as they do on GitHub for the common cases: centered screenshots, linked badges, relative screenshots, the language switcher link.
- An `<img>`'s `width`/`height` is lost; the renderer sizes images to the pane.
- Links with a non-line fragment (`#section`) stay plain text (the official link parser declines them). There is no in-page anchor navigation.
- HTML outside the vocabulary (`<details>`, `<br>`, `<table>`) still prints literally.
