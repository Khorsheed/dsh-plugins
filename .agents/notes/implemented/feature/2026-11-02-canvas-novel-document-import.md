# Agent Note: Document import splits chapters locally and reuses reconciliation

Status: implemented

## Problem

People with an existing novel had to paste or register every chapter by hand before the canvas could build its memory. A whole book may arrive as one Word document or as many text files, and asking the model to split and rewrite all of it would be slow, lossy and hard to verify.

## Decision

- The 章节 face has an 导入小说 launcher accepting multiple `.txt`, `.md` and `.markdown` files. On the host, 导入文件夹 uses the official `directoryPicker`: native selection and reading stay on the host, while the browse backend used by production 3080 opens its registered `sidebar.workspaces.directoryFlow`. Only that flow's confirmed path goes back to the Remote, which validates it through the same browse capability and reads the normalized path it returns. A native request carrying a path is refused. The native client passes the Remote's selection parameter as an explicit `undefined`: the gateway counts a trailing optional parameter in its positional arity, and an empty object is not a valid selection. Plain text uses UTF-8 with a GB18030 fallback. `.doc` and `.docx` receive conversion instructions rather than parsing; empty chapters and chapters over the existing 2,000,000-character limit receive explicit errors.
- Directory reading recurses through 32 levels, up to 500 supported documents and 100MB, with an explicit truncation flag. Hidden entries, `node_modules`, `__MACOSX`, unsupported formats and symlinks are skipped. Word files produce conversion guidance without being read. Only relative paths and the selected supported files' bytes reach the preview; the full directory tree is not returned.
- Files join in natural filename or relative-path order, including Chinese chapter numerals. Only standalone chapter headings split a document: numbered Chinese and English headings, prologue/epilogue/extra headings, and Markdown headings. Unnumbered documents become one chapter. Front matter joins the first chapter; prose is never split by length or rewritten by a model.
- A preview lists source, title and character count and lets the person deselect chapters. Confirmation calls `importOwnChapter` sequentially. The Remote uses the existing `writeChapter` path with `byUser: true`, so workspace permission, manuscript-first persistence, number allocation and no-overwrite behavior remain identical.
- A failed write stops later chapters and reports the actual imported count. The preview remembers allocated chapter numbers so retrying affects only the remainder. Successful imports send one ordinary conversation request for all allocated chapters. A non-empty user draft is preserved and the request is only drafted; the UI never claims reconciliation ran in the background.
- The novel skill processes that list in order through the existing `novel_extract(prepare) → subagent → novel_extract(import)` flow. Summary, setting, character, relation and foreshadow extraction is unchanged.

## Alternatives considered

- **A private background model pipeline.** Rejected: the current session already owns reconciliation and makes progress visible. An ordinary conversation message also preserves the person's unsent draft instead of creating a hidden agent channel.
- **A private directory tree, bundling the host UI, or mounting both picker backends.** Rejected: the host already owns the native and browse interactions. The novel consumes the registered flow through its slot; native selection accepts no path, and browse selection uses the host's existing list permission and normalized response rather than a new filesystem capability.
- **Server-side Office conversion.** Rejected: LibreOffice and Office skills are optional host capabilities, and text-only import needs no converter dependency.
- **Model-based or length-based chapter splitting.** Rejected: it can move or alter prose and adds model cost to a mechanical step. Only explicit headings create boundaries; ambiguous documents stay whole.

## Consequences

- `.doc` and `.docx` must be saved as UTF-8 TXT or Markdown before import. Documents with unconventional or missing headings need a small manual edit before automatic splitting.
- Folder import is host-only; remote pages keep multi-file upload. Depth, file-count and byte caps mean very large books may need subfolder batches, and truncation is always visible.
- Partial imports remain visible chapters rather than being rolled back. The person can resume the remainder without duplicating the chapters already written.
- DOCX support initially used Mammoth. It was later withdrawn to remove the parser dependency and repair browser loading; [the text-only decision](../bug-fix/2026-11-02-canvas-novel-text-only-import.md) owns that partial supersession.

## Validation

- Pure-text parser tests cover Chinese, English and Markdown headings, front matter, natural and Chinese-numeral file ordering, GB18030, empty and oversized files, and conversion guidance for `.doc` and `.docx`.
- Real nested-directory fixtures verify recursion, relative-path order, hidden/dependency/unsupported skips, symlink refusal, Word guidance without Word bytes, native cancellation, official browse confirmation, unavailable capabilities and the 500-file truncation flag.
- Real Remote + Store tests verify native picker directory import, refusal of a path on the native arm, manuscript persistence, consecutive numbers, `byUser`, `extractPrepare`, permission refusal and existing-file protection. Browse selection goes through the official capability's normalized listing.
- Browser interaction tests cover both launchers, preview, deselection, ordered writes, allocated-number reconciliation, draft-only messaging, failure stop and resume, native picker cancellation, the host directory-flow fallback, unavailable capability and off-host hiding. The folder tests use the real generated `importDirectory` descriptor: the old one-argument call reproduces `expected 2 argument(s), got 1`; explicit `undefined` and the browse-confirmed path both reach preview.
- A read-only scan of the user's `source` folder finds 18 supported documents and parses 18 chapters without issues or truncation; no manuscript bytes are added to the repository.
- Package build and test cover type generation, text import and execution of the browser artifact without Node facilities.
