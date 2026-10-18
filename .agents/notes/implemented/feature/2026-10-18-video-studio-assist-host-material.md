# Agent Note: video-studio — host-material selection menu and the AI-assist composer handoff

Status: implemented

## Problem

Two gaps surfaced when reviewing the shipped M1 on the production instance:

1. The selection bubble did not look like the host: a blue accent border, text glyphs that render as colored emoji on macOS (the red scissors), and a red 剪掉 row — while the host's own selection menu and the quote package's `SelectionMenu` use a translucent menu surface with a hairline elevation stroke and uniform icon rows. The panel's empty state and sticky bars likewise predated the host's elevation material.
2. Anything beyond mechanical cleanup (find/replace, the filler/pause scan) meant hand-writing a brief in the conversation. And a panel-initiated LLM call would be invisible — no request, no model name, no token cost — so the panel must never make one. The missing piece was a one-click handoff that drafts a good brief into the session's composer for the user to complete and send.

## Decision

- **The selection menu rebuilds on the official Menu material** (the quote package's SelectionMenu recipe): a translucent `--dsw-specific-menu` surface with backdrop blur (opaque `--dsw-alias-bg-layer-1` fallback on older hosts), the hairline elevation stroke (`--dsw-elevation-stroke-color` = `border-l1`) with the `elevation-prominent` shadow (fallback shadow where the tokens are absent), 16px radius, and uniform 14/22 rows with 14px inline-SVG icons in `label-secondary`. The icons live in the new `src/client/icons.tsx` on the host's 16×16/1.3-stroke grid; the pen glyph reuses the host list-pen artwork via quote's generated copy. 剪掉 loses its red — the host menu has no colored rows. Absolute positioning inside the list stays (the panel rule bans `fixed`), plus click-away dismissal and mousedown-prevention so the selection survives until the action runs.
- **The rest of the panel aligns to the same material**: the empty-state hero drops its dashed card for the host guide recipe (15px/500 title, tertiary 13px hint, one primary action); the find bar, player bar and undo bar trade their borders for the hairline-stroke + prominent-shadow elevation; control corner radius goes 7→8px. Primary buttons stay business-blue — panel-design.md reserves solid black for the host itself.
- **AI 帮改**: a 文稿-tab action primes the CURRENT session's composer with a proofread/polish brief naming the bound project — it never sends. The mechanism is library's `primeConversation` pattern (`sessions.scope(id).get('conversation').input`, structurally probed, clipboard fallback with a panel notice). The tab only mounts in 剪辑模式 sessions, so the `video_*` tools are guaranteed present, and the tools resolve the project from the session binding (`resolveProject`), so the brief needs no ids. Everything the agent does lands as proposal groups in the panel; the request, model and token cost stay in the host's conversation UI where they belong.

## Alternatives considered

- **A panel-side LLM call with an in-panel request/usage log**: rejected — no sanctioned plugin→model service exists, cost/model visibility would become the plugin's own job, and it would bypass the proposal discipline.
- **Creating a fresh 剪辑-mode session per assist (the eval/datasets pattern)**: rejected — the panel is session-bound and only mounts in 剪辑模式 sessions, so the current composer is always the right target; a new session would orphan the user's context.
- **Keeping the red 剪掉 row**: rejected — the host menu's uniform rows are the reference; the cut's destructiveness is carried by the undo bar and the source view, not by menu color.
- **Pure-black primary buttons (the room empty state)**: rejected — panel-design.md reserves the solid black fill; the host Button's black is the host's own prerogative.

## Consequences

- `VideoPaneInjected` gains `primeConversation(text): boolean`; the client's existing `sessions` inject (declared for preset visibility) now also serves the composer handoff.
- `TranscriptTab` requires a `report` prop (ProjectScreen's notice channel) for assist feedback.
- `src/client/icons.tsx` is hand-maintained artwork; new rows draw on the same 16×16 grid, 1.3 stroke, currentColor.

## Testing

`pnpm --filter @khorsheed/dsh-video-studio build` green (gen-typert + tsc + tsdown), package suite 29/29 green, `pnpm check:panels --package packages/video-studio` 0 errors; deployed to 3080 and screenshot-reviewed (desktop panel, light and dark).
