# Agent Note: Source import via the host's native directory picker — pick a folder, check its media files

Status: implemented

## Problem

Importing sources meant typing host paths into a textarea, one per line — the single most error-prone step of the panel flow (typos surface only as ffprobe failures, and most imports are "everything in this recording folder"). The user asked whether the host's file-dialog capability could serve this instead.

## Decision

The host's picking seam (`remote.directoryPicker`, host ≥ 0.1.2) is **directory-only** — `pickNativeDirectory` is `choose folder` / zenity `--directory` / kdialog `--getexistingdirectory` / Win32 `IFileOpenDialog` in folder mode, single selection, no file mode. So the flow is folder-pick + in-panel file selection:

1. 素材 tab gains a 选择文件夹… button, rendered only when `browserOnHost()` (the dialog opens on the host's display; the panel-design rule hides host-only gestures for remote pages).
2. The button calls the pane face's `pickDirectory`, which reads `ctx.get('remote.directoryPicker')` at click time — the local-files pattern: `ctx.get`, never an inject, so a composition without the picker yields undefined and the click degrades to a cancel-shaped null instead of pending the whole plugin.
3. A new `listMedia` Remote verb (`VideoStudioService.listMediaFiles`) lists the audio/video files directly inside the chosen folder (extension-filtered by the same AUDIO_EXT/VIDEO_EXT sets import uses, name-sorted, no recursion, size via stat — no ffprobe, so listing stays instant). The listing is a same-package verb: the host's browse backend lists directories only, and local-files' listing remote is another plugin's face, which cross-plugin rules forbid depending on.
4. The panel shows the files as an all-checked checklist (type dot, name, size); 导入所选 imports the checked paths through the existing `importSources` path (the 连续录制 toggle applies). The textarea stays for remote pages and paste-from-conversation flows.

## Alternatives considered

- **Upstream file mode for the picker** (`pick({ kind: 'file', multiple, filters })`): the genuinely nicer gesture (native multi-select with type filters), but it is a harness change through the upstream pipeline; the folder + checklist flow ships today and covers the dominant "a folder per recording session" layout. Recorded here as the reintroduction condition: if the seam grows a file mode, the checklist step collapses into the native dialog.
- **Browser `<input type="file">`**: yields File objects without host paths; the import design is deliberately path-based ("文件留在原处，不复制、不上传") because ffmpeg reads the originals. Uploading gigabytes of recording to satisfy a picker defeats it.
- **Directory-only import (no checklist)**: a folder rarely contains exactly the wanted files; the checklist costs one click and prevents importing the drafts and exports that also live there.

## Consequences

- The dominant import path is now: pick the session folder → uncheck the extras → 导入所选. No typing, no path typos.
- Nothing changes for remote pages (button hidden) or for hosts without the picker (cancel-shaped null); the textarea flow is untouched.
- `listMedia` is read-only and scoped to one directory level; it is not a general filesystem browse capability.

## Testing

`core.spec.ts` gains a `folder-pick import` case (extension filter, name sort, no recursion, unreadable-folder error). `pnpm --filter @khorsheed/dsh-video-studio build && test` green; `pnpm check:panels --package packages/video-studio` clean.
