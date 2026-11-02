# Agent Note: Document import splits chapters locally and reuses reconciliation

Status: implemented

## Problem

People with an existing novel had to paste or register every chapter by hand before the canvas could build its memory. A whole book may arrive as one Word document or as many text files, and asking the model to split and rewrite all of it would be slow, lossy and hard to verify.

## Decision

- The 章节 face has an 导入小说 launcher accepting multiple `.docx`, `.txt`, `.md` and `.markdown` files. On the host, 导入文件夹 uses the official `directoryPicker`: native selection and reading stay on the host, while the browse backend used by production 3080 opens its registered `sidebar.workspaces.directoryFlow`. Only that flow's confirmed path goes back to the Remote, which validates it through the same browse capability and reads the normalized path it returns. A native request carrying a path is refused. Mammoth always extracts DOCX prose in the browser; plain text uses UTF-8 with a GB18030 fallback. Legacy `.doc`, damaged files, empty chapters and chapters over the existing 2,000,000-character limit receive explicit errors.
- Directory reading recurses through 32 levels, up to 500 supported documents and 100MB, with an explicit truncation flag. Hidden entries, `node_modules`, `__MACOSX`, unsupported formats and symlinks are skipped. Only relative paths and the selected supported files' bytes reach the preview; the full directory tree is not returned.
- Files join in natural filename or relative-path order, including Chinese chapter numerals. Only standalone chapter headings split a document: numbered Chinese and English headings, prologue/epilogue/extra headings, and Markdown headings. Unnumbered documents become one chapter. Front matter joins the first chapter; prose is never split by length or rewritten by a model.
- A preview lists source, title and character count and lets the person deselect chapters. Confirmation calls `importOwnChapter` sequentially. The Remote uses the existing `writeChapter` path with `byUser: true`, so workspace permission, manuscript-first persistence, number allocation and no-overwrite behavior remain identical.
- A failed write stops later chapters and reports the actual imported count. The preview remembers allocated chapter numbers so retrying affects only the remainder. Successful imports send one ordinary conversation request for all allocated chapters. A non-empty user draft is preserved and the request is only drafted; the UI never claims reconciliation ran in the background.
- The novel skill processes that list in order through the existing `novel_extract(prepare) → subagent → novel_extract(import)` flow. Summary, setting, character, relation and foreshadow extraction is unchanged.

## Alternatives considered

- **A private background model pipeline.** Rejected: the current session already owns reconciliation and makes progress visible. An ordinary conversation message also preserves the person's unsent draft instead of creating a hidden agent channel.
- **A private directory tree, bundling the host UI, or mounting both picker backends.** Rejected: the host already owns the native and browse interactions. The novel consumes the registered flow through its slot; native selection accepts no path, and browse selection uses the host's existing list permission and normalized response rather than a new filesystem capability.
- **Server-side Office conversion.** Rejected: LibreOffice and Office skills are optional host capabilities, and the typert overlay does not carry plugin-only host dependencies. Returning only the selected bytes keeps Mammoth in the browser and needs no upstream or generator change.
- **Model-based or length-based chapter splitting.** Rejected: it can move or alter prose and adds model cost to a mechanical step. Only explicit headings create boundaries; ambiguous documents stay whole.

## Consequences

- DOCX import keeps prose and paragraph order, not Word formatting or text embedded in images. Legacy `.doc` needs conversion to `.docx`. Documents with unconventional or missing headings need a small manual edit before automatic splitting.
- Folder import is host-only; remote pages keep multi-file upload. Depth, file-count and byte caps mean very large books may need subfolder batches, and truncation is always visible.
- Partial imports remain visible chapters rather than being rolled back. The person can resume the remainder without duplicating the chapters already written.
- Mammoth is bundled into the client artifact, increasing its size in exchange for one maintained DOCX parser and no host dependency.

## Validation

- Real DOCX fixtures generated with JSZip cover Chinese headings; pure parser tests cover English and Markdown headings, front matter, natural and Chinese-numeral file ordering, GB18030, empty and damaged files, legacy `.doc` and oversized chapters.
- Real nested-directory fixtures verify recursion, relative-path order, hidden/dependency/unsupported skips, symlink refusal, damaged DOCX, native cancellation, official browse confirmation, unavailable capabilities and the 500-file truncation flag.
- Real Remote + Store tests verify native picker directory import, refusal of a path on the native arm, manuscript persistence, consecutive numbers, `byUser`, `extractPrepare`, permission refusal and existing-file protection. Browse selection goes through the official capability's normalized listing.
- Browser interaction tests cover both launchers, preview, deselection, ordered writes, allocated-number reconciliation, draft-only messaging, failure stop and resume, native picker cancellation, the host directory-flow fallback, unavailable capability and off-host hiding.
- `pnpm --filter @khorsheed/dsh-canvas-novel run build` verifies type generation and the browser bundle; `pnpm --filter @khorsheed/dsh-canvas-novel run test` passes all 28 files and 243 tests.
