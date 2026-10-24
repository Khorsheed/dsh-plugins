# @khorsheed/dsh-game

English | [中文](README.md)

Build a small game together with the agent: settle the gameplay in the conversation, read the chaptered design doc and play the latest version that passed its checks in the right sidebar's Game tab.

You do not need game-design experience — the agent writes the code and acts as your design partner: first it settles a one-sentence pitch, the kinds of elements and an art style (picked from examples) with you, then builds the smallest playable version and iterates from how playing it feels. When each turn ends, the plugin checks what changed (data validation, a load-and-run smoke test, the test scripts the agent writes with the code); a failure goes back to the agent to fix in the same turn (at most twice), a pass goes straight into the play area.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-workbench.png" width="640" alt="The agent changing the game in the conversation on the left; the right sidebar's Game tab playing the latest version, with parameter sliders below">

## Features

- **Settle the gameplay before building**: a project needs a title, a one-sentence pitch, element types and the art style you chose; whatever is missing, the agent asks you instead of inventing it. The art-style gallery draws one little scene in six styles for you to pick from.
- **A playable minimum, early**: the agent builds the smallest version that plays, then iterates from how it feels to you. Two runtimes: 2D (the default) and 3D.
- **Checks every turn**: when a turn ends, the data is validated, the build loads in headless Chrome on this machine for a 2-second smoke run, and the agent's tests run; a failure goes back to the agent in the same turn (at most twice), a pass becomes a new version in the play area (with Auto-deploy off, it waits for your "Confirm").
- **Play and tune**: the play area shows a poster until you press Play; the params the game declares become sliders that only change the running game; when it feels right, Finalize writes them back and commits a new version, or "Tell the agent" writes them into the composer. Pick tells which element is under a click and quotes it into the chat.
- **Turn card**: after each agent turn, a card under its reply lists the version that went live, the check, the changed elements, design chapters, parameters and code, and each row's View jumps to the place in the tab.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-turn-card.png" width="640" alt="The turn card under the agent's reply: version, check result, changed elements and design chapters, each row with View">

- **Everything visible has an editable look**: the hero, enemies and items, and scenery too — trees, rocks, buildings — all carry a look and show up under Elements: draw it in the pixel editor, turn a 3D element on a draggable turntable and adjust proportions and parts under the folded fine-tuning; "ask the agent for a new look" offers 3 variants side by side, and picking one writes it into the element.
- **Edit in the panel, commit as a version**: looks, fields and lore edited in the panel go straight into the project and the preview follows at once; a bar above the tabs reads "N edits not in the game yet · Commit as a new version", which runs the same checks and swaps a passing build into the play area, or offers "Ask the agent to fix". The agent sees what you changed when it reads the project, so it does not revert it.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-elements.png" width="640" alt="An element open under Elements: the look editor, the agent's three look variants side by side, the lore card below">

- **Publishing mid-turn**: before the agent asks you to play anything, it must run the checks on the spot and publish a passing version (`game_publish`), so what you open is the latest playable build.
- **Versions and rollback**: the Versions page has the last check (three layers, findings, the headless screenshot) and the version timeline — live / candidate / rejected / past; a candidate can be tried, rejected or confirmed, and you can switch back to any version, diff its files against live, or export a single-file `.html` to share.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/game-versions.png" width="640" alt="The Versions page: the last check's verdict and headless screenshot, then the timeline of live, candidate and past versions">

- **Element lore**: every element has a lore card — who it is, its temper, how it meets the player — which the agent follows for behavior and wording; the design doc gathers them into an "element lore" chapter.
- **A chaptered design doc**: the one-pager (pitch, element kinds, style) and the design pillars pinned on top, chapters that expand in place and can be edited directly; "elements & numbers" draws comparison bars, the playtest log is written automatically.
- **Switch between projects**: the title is the project switcher; project cards show the latest screen, live version, style, element count and the pitch; the first card, "New project", writes an opener into the composer.

On the model side: four tools, `game_open` / `game_read` / `game_propose` / `game_publish`, and two skills, `gamedev` (how to build) and `game-design` (mentoring you through the design).

## Install

Recommended: the game-development suite, together with the basic experience:

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-gamedev-suite
```

Restart the instance, then pick 游戏开发模式 (game-development mode) in the session's mode picker: a game-developer + design-mentor persona with the tools and skills above.

Advanced: this package alone.

```sh
dsh plugin --profile web add @khorsheed/dsh-game
```

Installed alone, the game tools and skills reach **every session** (aligned with canvas). To keep them exclusive to game-development mode, disable the `game-agent` row in the profile and install the suite instead. Uninstall with the matching `remove`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `stateRoot` | `$DSH_HOME/state/game` | Directory of the project registry and session bindings |
| `chromePath` | `CHROME_PATH`, then common install paths | Chrome for the per-turn checks; without one only the data checks run and the browser part is reported skipped |

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ❌ unsupported — the per-turn checks need `agent/turn-stopping` and `agent.steer`, and the preset needs the `@deepseek-ai/dsh-agent-preset` row type; 0.1.5 has neither.
- Source line (deepseek-harness master): ✅ (verifiedHost: 0.2.1-rc.1) — host-021 wave: full build+test green against the 0.2.1-rc.1 tree, no other surface changes. Degraded: the check findings steered back to the agent are plugin-sourced context messages, which the 0.2.0 chat view hides (a collapsible chat row is a later milestone); the headless checks need Chrome installed on the host. A headless profile has no browser consumer, so no tab appears there, but the checks still run.

## Known Limitations

- **Two runtimes**: 2D (native canvas plus an HTML UI layer, the default) and 3D (`runtime: 3d` when the project is created: bundled three.js 0.170 plus the thin dsh3d runtime — creatures assembled from parts recipes, ink and 青绿 styles, a 45° overhead camera). The sandbox blocks every outside request, so all code and assets live in the project. A 3D glTF look shows a placeholder block for now (the loader comes with the refine milestone).
- **Everything is drawn in code**: the host has no image generation, and the art styles offered are the ones code draws well.
- **No sharing with other players yet**: beyond the single-file export, itch.io publishing is a later milestone; leaderboards and multiplayer need a server and come after that.
- **"Checks failed" rows sit inside the step groups**: the plugin's conversation row ("checks failed n/2") is folded by the host into the turn's step groups — once a turn ends, expand "Done in …" and the step group to see it (the host's list of standalone node kinds is not open to plugins). The same information is under Versions in the sidebar.
- **Looks are pixel rows only**: element looks use the pixel-row format (`look`); SVG/vector looks are not editable in the panel yet.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Projects live in the workspace.** A project is one folder in the session's workspace (`game.json`, `index.html`, `src/`, `assets/`, `elements/`, `design/`, `tests/`); the plugin's version snapshots, check results and playtest log sit in the project's own `.game/`, so the folder moves as one. `$DSH_HOME/state/game/` holds only the project registry and session bindings.

**Two rows.** The package's `cordis.patch.yml` inserts two rows: `game` (service core, Remote, the per-turn checks) and `game-agent` (the `./agent` entry: tools, prompt section, skills), both enabled by default. The `dsh-gamedev` mode pack in `@khorsheed/dsh-gamedev-suite` does not re-mount the root row; it grants the same entry inside its own preset composition, and under host 0.2.x that mode's sessions see the scoped copy shadow the global row — no double registration, no boot failure (pinned by the host's scoped.spec.ts).

**The light gate.** Before `game_open` creates a project it checks for a title, a one-sentence pitch, element types and the art style the user chose; the tool answers with whatever is missing.

**The play area and the headless checks share one loader** (`src/vfs.ts`): a `sandbox="allow-scripts"` opaque-origin iframe receives the project's files, mints blob URLs in its own origin, rewrites relative imports and CSS `url()`, takes over `fetch` and image/audio `src`, then writes `index.html` over itself; `localStorage` is a bridged stand-in whose writes are posted back for the panel to keep in the browser.

**The per-turn checks** hang on `agent/turn-stopping` (fires only on a normal finish, so a user's stop is never overridden) and touch only sessions bound to a project whose `index.html` exists and whose build fingerprint changed. The three layers run in order: `game.json` and element files are validated → the build loads in headless Chrome for a 2-second smoke run (errors, `window.dshGame.ready`, a canvas that is not one flat color) → `tests/*.test.js` run. A failure goes back into the same turn through `agent.steer`, at most twice per turn; a third failure is recorded as "stopped auto-fixing". `game_publish` runs the same checks on demand; asking you a question does not end the agent's turn, so the skill and the mode persona require a passing publish before the agent asks you to play.

**A version** is a build snapshot under `.game/versions/<n>/` (the newest 10 are kept); `current.json` names the one in the play area, `versions.json` keeps the history (rejected included).

**The user layer** lives in `.game/user.json`: slider trial values, changes the agent has not read yet (the `game_read` overview lists them once, then clears them), panel edits no version carries yet (the next version, committed from the panel or published by the agent, writes them into its note "面板修改：…" and clears them), and a restyle request; look proposals in `.game/proposals.json`. A mid-project restyle has the agent redraw everything and always lands as a candidate.

**The runtime surface.** The loader puts params and elements on `window.dshParams` / `window.dshElements` before the game starts; slider trial values are pushed in by postMessage, so a game that reads them every frame changes live; `dshDraw` draws pixel looks and `dshGame.pick(x, y)` enables picking. 3D scenery shapes are registered with `defineBase` in `src/looks.js`, built once and cloned across the scene, so the element grid can render and tune them.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/game`). `probes/` holds the pre-implementation probe scripts and is not published. Issues and contributions go there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
