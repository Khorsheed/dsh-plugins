# Agent Note: bound large-file reads to the preview window (local-files, file-preview)

Status: implemented

English | [中文](2026-09-15-bounded-preview-reads.zh.md)

## Problem

Both preview readers loaded the whole file into memory and sliced afterwards. local-files' `readFile` ran `fs.readFile(canonical)` — a 2 GB log came fully into the heap before `subarray(0, 2MB)` — and file-preview's unknown-size branch did the same through `ctx.fs.readText`. The documented "reads at most MAX_CONTENT_BYTES" was true of the response, not of the read. The host-016 wave inherited the fix from host-015 batch 4 ("大文件分页 → `ctx.fs.readByteRange`"), scoped to bounded reads plus host-side window plumbing; client paging UI is a follow-up.

## Decision

- **local-files keeps its node:fs safety model and reads windows through a file handle**: `open()` + `read(buffer, 0, length, position)` capped at `MAX_CONTENT_BYTES + 1` (`> MAX` ⇒ `truncated`, body is the first MAX bytes; same U+FFFD-at-the-cut behavior as before). Images short-circuit on `stat` size before opening — but the post-read `byteLength > MAX` check stays as a race belt: if the file grows between stat and read, the old behavior is `too-large`, and dropping it would silently emit half an image as a data URL.
- **The Remote gains additive paging plumbing**: `ReadLocalFileRequest.offset?: number` (default 0) and `LocalFilesRead.nextOffset?: number` (present only when truncated, a byte position). Purely additive — the client compiles against the regenerated typert types and consumes neither yet. `offset` applies to text only: an image is an all-or-nothing data URL and windowing it would corrupt it (documented in the type comments).
- **file-preview swaps to the official range read**: `ctx.fs.readByteRange(target, { offset: 0, length: cap + 1 })` — available since 0.1.5-rc.1 on the abstract `Fs` interface, so no probe is needed (minHost already 0.1.5-rc.1). Non-fatal `TextDecoder` replaces the string slice; `truncated` keeps the "file exceeds cap" meaning, the known-size `too-large` short-circuit and the `isScriptedHtml` branch are untouched. The public parameter carries an explicit type annotation because the typert analyzer requires it.

## Alternatives considered

- **Client paging UI in the same pass** — deferred to the wave's post-rc discussion list: the wave's bar is green build/test plus byte-identical behavior, and a paging UI is a feature with its own acceptance, not adaptation.
- **`ctx.fs.readByteRange` for local-files too** — rejected: local-files is deliberately self-contained on node:fs with its own `assertSafeLocalPath` model; a handle-based window read reaches the same bound without new service wiring.
- **Dropping the image post-read check after the stat short-circuit** — see the race belt above; three lines for an honest failure mode.

## Consequences

- Response vocabulary is byte-identical (`kind`-union, `truncated`, `size`); the only user-visible change is memory profile: a huge preview no longer reads the whole file.
- `nextOffset` counts bytes, so a window that cut a multi-byte character resumes mid-character and the continuation begins with U+FFFD — the same tolerance the sliced reads already had.
- Tests pin the window contract (read length ≤ MAX+1, offset positions, `nextOffset` continuation with no overlap/gap, image stat short-circuit, non-fatal UTF-8 decode, `too-large` regression).
