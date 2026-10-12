# Agent Note: Video studio — the 剪辑 tab self-hides outside 剪辑模式

Status: implemented

## Problem

The M1 proposal mounted the 剪辑 right-sidebar tab unconditionally ("deployment-level workspace, no session-preset self-hide"). In daily use that put an editing console on every session — code, chat, everything — when the user only ever edits in 剪辑模式 sessions. The user decision: the tab and its tools belong to 剪辑模式 only.

## Decision

The tab type registers exactly while the current session can reach the `video_*` tools — the criterion is the official `pluginInventory` Remote: the `@khorsheed/dsh-video-studio/tool` row in the session's preset composition (the row is preset-mounted only, never root-mounted; a root-entries check stays as the future-proof second path). `src/client/preset-visibility.ts` is an inline copy of the canvas double-check module (`RegistrationToggle` included), per the keep-copies rule in docs/plugin-visibility.md. Every unreadable path fails open; 标准模式 is the harness's built-in `standard` preset and never names the row, so the tab hides there. The tab body slot stays registered (the canvas staging): an open tab of an unregistered type renders the host's designed `tab.unavailable` fallback.

The tools and the skill already rode the preset (the `./tool` row is granted per session by `preset-dsh-video`); no change there. The preset itself is now a standalone composition rather than a trimmed copy of the writing mode: persona + fs (finding recordings) + skill loader + compaction + ask-user + todo + the video-studio tool row. The shell rows (bash/pwsh) were dropped — a shell bypasses the proposal discipline the editing flow is built on — and web was dropped as not part of the editing workflow.

## Alternatives considered

- **Keep the panel always visible (the M1 proposal's original call).** The panel works without the tools, but the user's product decision is that editing is a mode, not a permanent fixture; the criterion has a真值 (the tool row) so the canvas "constant-false" trap does not apply.
- **Hiding the panel body (`return null`) instead of unregistering the type.** Leaves an empty shell button in the guide — the convention requires the registration-level toggle.
- **Keeping bash/web in the preset.** Rejected per row: nothing in the editing flow calls them, and every extra tool is prompt surface the editing session pays for.

## Consequences

- `inject` on the client half gains `'sessions'` (the criterion reads the session list); missing it crashed the client plugin at boot with a one-line "did not activate" — the kind of failure only a live reload shows.
- Sessions keep their layout: a 剪辑 tab opened in a 剪辑模式 session stays in that session's stored layout; on a 标准模式 session a leftover open tab renders `tab.unavailable` by design.
- Blank drafts flip verdict live when the mode chip changes (the draft's preset projection updates in place) — verified by toggling the same draft between 标准模式 and 剪辑模式.

## Testing

Live on the 3197 temp instance: fresh 标准模式 session → the guide offers no 剪辑 entry; the same draft switched to 剪辑模式 → the type registers and the panel opens; switched back → unregistered, the leftover open tab renders the host's unavailable fallback; composition inspected on the wire (`pluginInventory.list()`) to confirm the trimmed dsh-video rows. The evaluation was misread twice before instrumentation (`__vsVisibility`, removed after): the lesson is that a treeitem click on a workspace node is not a session switch, and a persisted open tab is not the guide.
