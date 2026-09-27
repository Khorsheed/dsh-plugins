# Agent Note: Manuscripts (成稿) are a separate entity, saved into the workspace

Status: implemented

## Problem

A canvas collects material: fragments, questions, documents, drawings. What the user eventually wants out of it is a piece of writing. Until now that writing was just one more `document` card. It had no version, so an agent rewrite and a user edit silently overwrote each other. It did not say which cards it drew on, or which it left out. It had no "done" state. And the only way to get it out of the deployment was to copy text by hand, with images left behind as `attachment://` pointers that mean nothing anywhere else. In the 2026-09-27 review the user chose a separate manuscript entity, written in the main session, over growing the document card (memory: canvas UX redesign decisions).

## Decision

**A manuscript is its own entity on the board.** `CanvasBoard.manuscripts[]` holds the metadata:

- id (`ms_…`), title, status (`writing` / `final`), version;
- sources: `used` and `unused` card ids (the unused list is the point: what the writing left out);
- who created it and who last wrote it;
- `fromCardId` when it was turned from a card;
- `exported` (workspace, path, file token, time) after a workspace save.

**The body lives outside `canvas.json`**, one markdown file per version under `manuscripts/<id>/`. A write creates the new version's file first (`createIfAbsent`), then commits the metadata through the ordinary version-guarded `mutate`. If the commit fails, the new file is removed; if it succeeds, the superseded file is removed. So a manuscript only ever points at a file that exists, and a large body never inflates every board read.

**Conflicts are detected with `baseVersion`, never merged.**

- A rewrite carries the version it started from. If the board has moved on, the write answers `stale` with `currentVersion`.
- The agent tool (`canvas_write_manuscript`) tells the model to re-read (`canvas_read_manuscript`) and rewrite on top of the latest.
- The page keeps the user's words and shows a banner with two ways out: 载入最新 (drop the edit, re-read) or 覆盖 (re-save over the version it lost to).
- An agent write reopens a `final` manuscript to `writing`.

**Writing happens in the main session.** The agent writes straight onto the board with `canvas_write_manuscript`; there is no side chat (retired in 3f7cd8b5). The page's 「让 Agent 改」 quotes the manuscript id and its current version into the main input, so the agent's rewrite carries the right `baseVersion`.

**转为成稿 is a manual gesture.** The 「文档」 category stays material. A document card's ⋯ menu offers 转为成稿, which creates a manuscript from the card's text with the card as its first used source. If the card was already turned, the same menu item reads 打开成稿 and opens the newest manuscript with that `fromCardId` instead of forking a second copy. HTML documents cannot be turned (the item is disabled).

**保存到工作区 writes into an attached workspace.**

- Output: `<workspace>/<title>.md`, with images written into `<title>.assets/` beside it and the pointers rewritten to relative links. File names are the image digest's head, so re-saves reuse names and one image pasted twice is written once.
- The fence is re-rooted: the session still decides the mode (`read-only` refuses), but the writable boundary is the workspace the user attached to this canvas. A request naming any other path is `denied`.
- The saved path and the file's token are remembered. The next save goes to the same file. It stops with `changed` if the file was edited outside since, or `exists` if a first save would land on a file the canvas never wrote. The page asks; 覆盖 re-sends with `overwrite`, and the write is still version-guarded against the file as just observed.
- Images are written first, so the markdown never links to a missing file. An image that could not be written keeps its pointer and is counted in `missingImages`.
- ⋯ also offers 复制 Markdown for the plain text.

**Host gap: `ctx.fs` is text-only.** Image bytes go through a node `writeFile` behind a constructor seam (`WriteBytes`), after a `ctx.fs.contains` check against the workspace root. Retire the seam when the host grows a binary write.

**Card naming.** A document card whose text starts with `# Heading` showed "# Heading" as its tab title, crumb and ledger chip. The new `cardNameOf` (card-format.ts) prefers the markdown heading for documents and falls back to `cardTitleOf`. The manuscript's reading view also drops a leading heading equal to the title, so the title is not shown twice.

**Delete** is operator-only like every delete: the metadata leaves the board, then the body directory goes. A file already saved into a workspace belongs to the user and stays. Deleting a card also removes it from every manuscript's source lists.

## Alternatives considered

- **Keep writing as a document card with a version field.** Rejected: sources, status and export all belong to the finished piece, not to material. Mixing them made the 「文档」 category mean two things.
- **Store the body in `canvas.json`.** Rejected: bodies go up to 512k characters and every board read would carry every manuscript.
- **Automatic merge on conflict.** Rejected: a three-way merge of prose is wrong often enough to be worse than asking. Two explicit ways out are clearer.
- **Turn every 「文档」 card into a manuscript automatically.** Rejected by the user: documents are also reference material.
- **Let the export name any path.** Rejected: the attached workspace is a boundary the operator chose on purpose; a free path would bypass it.
- **Inline images as data URIs in the exported markdown.** Rejected: unreadable in editors and git diffs, and heavy.

## Consequences

- The board carries a 成稿 face (list, newest first, with used/unused counts), and manuscripts open as their own page in the strip.
- Board schema grows `manuscripts` (normalized to `[]` for older boards) and each canvas directory may hold `manuscripts/`.
- A manuscript's images are only as portable as the attachment store: without one mounted, a save writes the markdown and reports every image as missing.
- The binary write is a node dependency on the host side until `ctx.fs` gains bytes.

## Testing

- `tests/manuscripts.spec.ts` over an in-memory filesystem (`tests/fake-fs.ts`): create/rewrite/stale, superseded-file cleanup, patch, delete, export fence (`denied`, `read-only`), `exists` / `changed` / `overwrite`, image rewrite and missing images.
- `tests/manuscript.client.spec.tsx`: reading view and ledger, ⌘⏎ save with `baseVersion`, the conflict banner's two ways out, the export ask, 让 Agent 改, and the list.
- Tool, agent, remote, detail (打开成稿 instead of a second fork) and card-format (`cardNameOf`) specs; 489 tests pass.
- Visually verified on a temporary instance: reading view, split editor, saves to v2/v3, ⋯ menu, workspace save, the overwrite dialog, and the list face.
