# @khorsheed/dsh-game

English | [中文](README.md)

Build a small game together with the agent: settle the gameplay in the conversation, read the chaptered design doc and play the latest version that passed its checks in the right sidebar's Game tab.

You do not need game-design experience — the agent writes the code and acts as your design partner: first it settles a one-sentence pitch, the kinds of elements and an art style (picked from examples) with you, then builds the smallest playable version and iterates from how playing it feels. When each turn ends, the plugin checks what changed (data validation, a load-and-run smoke test, the test scripts the agent writes with the code); a failure goes back to the agent to fix in the same turn (at most twice), a pass goes straight into the play area.

## Features

- **Game-development mode**: the `dsh-gamedev` (游戏开发模式) preset in `@khorsheed/dsh-presets` — a developer + design-mentor persona, two tools (`game_open`, `game_read`) and two skills (`gamedev` for the mechanics, `game-design` for mentoring).
- **Projects live in the workspace**: a project is one folder in the session's workspace (`game.json`, `index.html`, `src/`, `assets/`, `elements/`, `design/`, `tests/`); the plugin's version snapshots, check results and playtest log sit in the project's own `.game/`, so the folder moves as one. `$DSH_HOME/state/game/` holds only the project registry and session bindings.
- **A light gate**: a project needs a title, a one-sentence pitch, element types and the art style the user chose; the tool answers with whatever is missing so the agent asks instead of inventing it.
- **The Game tab, a game-design workbench**:
  - Play: nothing runs until you press Play (a poster first, so a big game costs nothing on every visit); then the game screen with a status strip (live/candidate version, error count, pick, restart), the candidate bar (try / reject / confirm), and the parameter drawer — the params the game declares in `game.json` become sliders that only change the running game (trial values, marked amber) and are not queued for the agent; when it feels right, "Tell the agent" (writes the trial values into the composer) or Finalize (into game.json), or Reset; Pick tells which element is under a click and quotes it into the chat.
  - Elements: a card grid filtered by type (pixel-look thumbnail + key numbers), multi-select to hand to the agent; one element opens a look editor (pen / recolor from the art-style palette, states), field editing, and "ask the agent for a new look" — the agent offers 3 variants with `game_propose`, shown side by side, and picking one applies it.
  - Design: the one-pager (pitch, element kinds, style) and the pillars pinned on top, chapters that expand in place and can be edited directly, an Updated mark and a progress bar; "elements & numbers" is generated with comparison bars, the playtest log is written automatically.
  - Versions: the last check (three layers, findings, the headless screenshot), the version timeline (live / candidate / rejected / past, switch back, file diff against live), single-file `.html` export to share, the playtest log.
  - Project switching: the title is the switcher ("name ▾"), opening project cards — the last check's screen, live version, style, element count, last change and the pitch, with the session's own project marked; the first card is "New project", which writes an opener into the composer (creation goes through the light gate with the agent).
  - Art-style gallery: one little scene drawn in six styles; without a project a pick goes into the composer, mid-project a restyle redraws everything and always lands as a candidate.
- **Turn card**: after each agent turn, beneath its reply (outside the fold), a card lists what the turn changed — the version that went live or waits, the check, new/changed elements, updated design chapters, parameters, code and tests — each row's View jumps to the place in the tab (element page, chapter, play, versions).
- **Asked after a change**: after editing a chapter, a look or fields, picking an option, finalizing parameters, rejecting or switching back a version, the panel asks "Tell the agent?" — Write into chat (editable in the composer before sending), Not this one, Later, or Turn off reminders; the header's "Remind" switch turns them on and off at any time.
- **You decide when the agent hears about panel changes**: moved sliders, edited looks/fields/chapters, rejected or switched-back versions apply at once and collect under "Panel changes" above the composer (each removable); "Write into chat" puts the list into the composer, you add your intent and send, and the list clears once sent. Nothing is slipped into your messages. Unsent changes also show in the agent's `game_read`, so it does not revert them.
- **Checks every turn**: `game.json` and element files are validated → the build loads in headless Chrome for a 2-second smoke run (errors, `window.dshGame.ready`, a canvas that is not one flat color) → `tests/*.test.js` run. A failure is steered back into the same turn, at most twice; a pass becomes a new version that deploys at once while auto-confirm is on (the default), or waits for your "Confirm" when it is off.

## Install

```sh
dsh plugin --profile <name> add @khorsheed/dsh-game
dsh plugin --profile <name> add @khorsheed/dsh-presets   # the game-development preset
```

The package's `cordis.patch.yml` inserts two rows: `game` (service core, Remote, the per-turn checks) and `game-agent` (the `./agent` entry: tools, prompt section, skills), both **enabled by default** — installing alone gives every session the tools (aligned with canvas). The `dsh-gamedev` mode pack does not re-mount the root row; it grants the same entry inside its own preset composition, and under host 0.2.x that mode's sessions see the scoped copy shadow the global row — no double registration, no boot failure (pinned by the host's scoped.spec.ts). To keep the game tools exclusive to game-dev mode, disable the `game-agent` row in the profile and use the mode pack instead.

## Config

| Key | Default | Meaning |
|---|---|---|
| `stateRoot` | `$DSH_HOME/state/game` | Directory of the project registry and session bindings |
| `chromePath` | `CHROME_PATH`, then common install paths | Chrome for the per-turn checks; without one only the data checks run and the browser part is reported skipped |

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ❌ unsupported — the per-turn checks need `agent/turn-stopping` and `agent.steer`, and the preset needs the `@deepseek-ai/dsh-agent-preset` row type; 0.1.5 has neither.
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree, no other surface changes. Degraded: the check findings steered back to the agent are plugin-sourced context messages, which the 0.2.0 chat view hides (a collapsible chat row is a later milestone); the headless checks need Chrome installed on the host. A headless profile has no browser consumer, so no tab appears there, but the checks still run.

## Known Limitations

- Two runtimes: 2D (native canvas plus an HTML UI layer, the default) and 3D (`runtime: 3d` when `game_open` creates the project: bundled three.js 0.170 plus the thin dsh3d runtime — creatures assembled from parts recipes, ink and 青绿 styles, a 45° overhead camera). The sandbox CSP blocks every outside request, so all code and assets live in the project. A 3D glTF look shows a placeholder block for now (the loader comes with the refine milestone).
- The host has no image generation: everything is drawn in code, and the art styles offered are the ones code draws well.
- No sharing with other players yet (single-file export and itch.io are later milestones; leaderboards and multiplayer need a server and come after that).
- The plugin's conversation row ("checks failed n/2") is folded by the host into the turn's step groups: once a turn ends, expand "Done in …" and the step group to see them (the host's list of standalone node kinds is not open to plugins). The same information shows above the composer and under Versions.
- Element looks use the pixel-row format (`look`); SVG/vector looks are not editable in the panel yet.

## How it works

- The play area and the headless checks share one loader (`src/vfs.ts`): a `sandbox="allow-scripts"` opaque-origin iframe receives the project's files, mints blob URLs in its own origin, rewrites relative imports and CSS `url()`, takes over `fetch` and image/audio `src`, then writes `index.html` over itself; `localStorage` is a bridged stand-in whose writes are posted back for the panel to keep in the browser.
- The checks hang on `agent/turn-stopping` (fires only on a normal finish, so a user's stop is never overridden) and touch only sessions bound to a project whose `index.html` exists and whose build fingerprint changed. A failure goes back into the same turn through `agent.steer`, at most twice per turn; a third failure is recorded as "stopped auto-fixing".
- A version is a build snapshot under `.game/versions/<n>/` (the newest 10 are kept); `current.json` names the one in the play area, `versions.json` keeps the history (rejected included).
- The user layer lives in `.game/user.json` (slider trial values, changes not yet told to the agent, a restyle request); when a message starting with "【面板改动】" reaches the model (`agent/pre-step`), the changes it lists are cleared; look proposals in `.game/proposals.json`. The loader puts params and elements on `window.dshParams` / `window.dshElements` before the game starts, panel edits are pushed in by postMessage, so a game that reads them every frame changes live; `dshDraw` draws pixel looks and `dshGame.pick(x, y)` enables picking.

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/game`). `probes/` holds the pre-implementation probe scripts and is not published. Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
