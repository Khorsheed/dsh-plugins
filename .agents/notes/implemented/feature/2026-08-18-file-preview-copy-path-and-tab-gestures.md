# Agent Note: File-preview copy path and tab host gestures

Status: implemented

English | [中文](2026-08-18-file-preview-copy-path-and-tab-gestures.zh.md)

## Problem

The [file-preview surfaces](2026-08-14-file-preview-side-drawer.md) showed a file's path only as compact relative rows (basename + folder + turn/step), so grabbing the actual path to paste into a terminal or another app meant hunting the session log. The drawer's header already offered "show in folder" / "open in IDE", but the 产物/Produced tab — the browse surface with the roomier list — had no path verbs at all, so opening or revealing a file from the tab was impossible without first clicking through the chat.

## Decision

Add one new gesture, **copy path**, to both surfaces, and bring the drawer's two host-open gestures onto the tab.

**Copy path** is a browser-clipboard action: the apply closure resolves the recorded display path against the owning session's cwd through the same `resolveWorkspacePath(cwd, path)` spelling the open gestures use, and writes it with the ui-primitives `writeClipboard` helper (async Clipboard API, `execCommand('copy')` fallback; resolves `true` only when the host accepted the write). Both surfaces receive it as an injected `copyPath: (path) => Promise<boolean>` verb — the same inject-face pattern as `openExternal`/`revealFolder` — so cwd resolution stays in one place and the components stay testable with a plain mock. A shared `useCopyPathFeedback` hook (plugin-local, the primitives' `useCopyFeedback` writes a fixed string and cannot resolve cwd) owns the transient feedback: a successful write flips the button to a check icon + "已复制/Copied" label for one second; a refused write is never claimed; the flag resets when the selection changes. Copy is **never gated** — clipboard writes work in any browser context — while the folder/IDE buttons stay behind the existing loopback + `canOpenPath` gate. Icons come from the ready-made ui-primitives set (`IconCopyOutline16`, `IconCheckOutline16`; folder/IDE keep `IconFolderOpenOutline16`/`IconCodeOutline16`).

**Tab gestures**: the `conversation.view` entry's inject gains `isLoopback` + `hooks.hostDescription` (the same hooks compartment that gives the drawer its `useHostDescription` selector) and `openExternal`/`revealFolder` verbs. One asymmetry is deliberate: the drawer resolves against the CURRENT session (it only ever previews the current session), while the tab resolves against its OWN `sessionId` — the tab is a per-session surface, and the recorded path may be relative to that session's cwd, not the current one. The tab renders a gesture row above the preview pane (copy, and folder/IDE when the deployment can open paths) only while a file is selected, mirroring the drawer header.

## Alternatives considered

- **Per-row copy buttons in the file list.** Rejected: the rows are a cramped name/dir/step grid, and a copy button on every row would clutter a list that can reach the service cap; the gesture row for the selected file matches the drawer's header and keeps the copy target explicit.
- **Resolving the path inside the components** (`useSessions` + `resolveWorkspacePath` in the view). Rejected: it would duplicate the cwd logic the open verbs already own, and component tests would have to stub the clipboard module instead of asserting a plain injected mock.
- **Reusing the primitives' `useCopyFeedback`.** Rejected: it captures a fixed text string and writes it itself, so it cannot sit behind the injected, cwd-resolving verb the open gestures share.

## Consequences

Two new locale keys (`drawer.copyPath`, `drawer.copied`) join the `filePreview` namespace in both languages. The drawer's copy button renders whenever a file is selected — including deployments that cannot open paths, where it is now the only path verb. The tab's gesture row makes the 产物 surface self-sufficient for path actions. The view's injected face grows (listFiles/readFile + the capability facts + three path verbs); existing component tests updated for the new props, with new coverage for copy success/refusal, gesture routing, capability gating, and the no-selection state. Clipboard writes remain a best-effort browser capability: `writeClipboard` returns `false` on permission denial and the UI simply stays on the idle label.
