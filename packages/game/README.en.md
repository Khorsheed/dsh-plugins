# @khorsheed/dsh-game

English | [中文](README.md)

Build a small game together with the agent: settle the gameplay in the conversation, read the chaptered design doc and play the latest version that passed its checks in the right sidebar's Game tab.

You do not need game-design experience — the agent writes the code and acts as your design partner: first it settles a one-sentence pitch, the kinds of elements and an art style (picked from examples) with you, then builds the smallest playable version and iterates from how playing it feels. When each turn ends, the plugin checks what changed (data validation, a load-and-run smoke test, the test scripts the agent writes with the code); a failure goes back to the agent to fix in the same turn (at most twice), a pass goes straight into the play area.

## Features

- **Game-development mode**: the `dsh-gamedev` (游戏开发模式) preset in `@khorsheed/dsh-presets` — a developer + design-mentor persona, two tools (`game_open`, `game_read`) and two skills (`gamedev` for the mechanics, `game-design` for mentoring).
- **Projects live in the workspace**: a project is one folder in the session's workspace (`game.json`, `index.html`, `src/`, `assets/`, `elements/`, `design/`, `tests/`); the plugin's version snapshots, check results and playtest log sit in the project's own `.game/`, so the folder moves as one. `$DSH_HOME/state/game/` holds only the project registry and session bindings.
- **A light gate**: a project needs a title, a one-sentence pitch, element types and the art style the user chose; the tool answers with whatever is missing so the agent asks instead of inventing it.
- **The Game tab**: Play (a sandboxed iframe; saves stay in your browser), Design (fixed chapters, pillars pinned first, status empty/draft/final; "elements & numbers" and "playtest log" are generated), Elements (one table per type) and Checks (the last verdict and its findings).
- **Checks every turn**: `game.json` and element files are validated → the build loads in headless Chrome for a 2-second smoke run (errors, `window.dshGame.ready`, a canvas that is not one flat color) → `tests/*.test.js` run. A failure is steered back into the same turn, at most twice; a pass becomes a new version that deploys at once while auto-confirm is on (the default), or waits for your "Confirm" when it is off.

## Install

```sh
dsh plugin --profile <name> add @khorsheed/dsh-game
dsh plugin --profile <name> add @khorsheed/dsh-presets   # the game-development preset
```

The package's `cordis.patch.yml` inserts two rows: `game` (service core, Remote, the per-turn checks) and `game-agent` (the `./agent` entry: tools, prompt section, skills), which ships **disabled** — the `dsh-gamedev` preset grants it per session. To give every session the game tools instead, enable `game-agent` and do not use the preset; the two must never be live at once (the tools would register twice).

## Config

| Key | Default | Meaning |
|---|---|---|
| `stateRoot` | `$DSH_HOME/state/game` | Directory of the project registry and session bindings |
| `chromePath` | `CHROME_PATH`, then common install paths | Chrome for the per-turn checks; without one only the data checks run and the browser part is reported skipped |

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ❌ unsupported — the per-turn checks need `agent/turn-stopping` and `agent.steer`, and the preset needs the `@deepseek-ai/dsh-agent-preset` row type; 0.1.5 has neither.
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.2.0-rc.2). Degraded: the check findings steered back to the agent are plugin-sourced context messages, which the 0.2.0 chat view hides (a collapsible chat row is a later milestone); the headless checks need Chrome installed on the host. A headless profile has no browser consumer, so no tab appears there, but the checks still run.

## Known Limitations

- 2D only (native canvas plus an HTML UI layer); the sandbox CSP blocks every outside request, so all code and assets live in the project.
- The host has no image generation: everything is drawn in code, and the art styles offered are the ones code draws well.
- No sharing with other players yet (single-file export and itch.io are later milestones; leaderboards and multiplayer need a server and come after that).
- Elements and the design doc are read-only in the panel: ask the agent for changes in the conversation.

## How it works

- The play area and the headless checks share one loader (`src/vfs.ts`): a `sandbox="allow-scripts"` opaque-origin iframe receives the project's files, mints blob URLs in its own origin, rewrites relative imports and CSS `url()`, takes over `fetch` and image/audio `src`, then writes `index.html` over itself; `localStorage` is a bridged stand-in whose writes are posted back for the panel to keep in the browser.
- The checks hang on `agent/turn-stopping` (fires only on a normal finish, so a user's stop is never overridden) and touch only sessions bound to a project whose `index.html` exists and whose build fingerprint changed. A failure goes back into the same turn through `agent.steer`, at most twice per turn; a third failure is recorded as "stopped auto-fixing".
- A version is a build snapshot under `.game/versions/<n>/` (the newest 5 are kept); `current.json` names the one in the play area.

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/game`). `probes/` holds the pre-implementation probe scripts and is not published. Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
