# Agent Note: Game-development mode (dsh-game)

Status: implemented

## Problem

The user wants to build small games with the agent: the conversation settles the gameplay, a right-sidebar panel shows the design and plays the result. The user has never worked as a game designer, so the agent has to mentor as well as code. The proposal (`proposals/active/2026-10-09-gamedev-mode.md`, decisions D1–D17) fixed the shape; this note records how M1 ships and what it rejected.

## Decision

`@khorsheed/dsh-game` (`packages/game`) plus a fourth preset, `dsh-gamedev` (游戏开发模式), in `@khorsheed/dsh-presets`.

- **Rows.** The core row `game` provides `ctx.gameStore`, mounts the `game` Remote and runs the end-of-turn checks. The `./agent` row `game-agent` (`game_open`, `game_read`, a one-paragraph prompt section, and the `gamedev` and `game-design` skills) ships disabled at the root; the preset names it — the canvas `./agent` pattern.
- **Storage.** A project is one folder in the session workspace (`game.json`, `index.html`, `src/`, `assets/`, `elements/*.json`, `design/*.md`, `tests/*.test.js`). The plugin's own state lives in the project's `.game/`: `versions/<n>/` build snapshots (newest 5 kept), `current.json`, `candidate.json`, `checks.json` and `playtest-log.jsonl`. `$DSH_HOME/state/game/registry.json` holds only the project list and the session bindings. The plugin writes `game.json` and `design/pillars.md` at creation through `ctx.fs` with the caller's policy. It writes `.game/` and copies the binary snapshots through node, behind a not-read-only check — the canvas precedent for binary writes.
- **Light gate.** `game_open create` refuses without a title, a pitch, element types, and an art style from `ART_STYLES` or `custom:<text>`. It answers with exactly what is missing, so the agent asks the user instead of inventing it.
- **No write tool and no test tool.** The agent writes files with the ordinary fs tools and writes tests together with the code.
- **Checks.** On `agent/turn-stopping`, for a session bound to a project whose `index.html` exists and whose build-plus-tests fingerprint changed, the plugin runs three stages:
  1. Validation of `game.json` and the element files.
  2. A smoke run in headless Chrome: `window.dshGame.ready` within 4 s, 120 `step` calls, a canvas that is not one flat color, and no runtime errors.
  3. Each `tests/*.test.js` file on a fresh load.

  A failure is `agent.steer`ed back into the same turn as a `dsh-game`-sourced snapshot message. The cap is 2 per turn; the third failure records `gaveUp`, and that fingerprint is not re-run. A pass snapshots a new version, which becomes current when `autoConfirm` is on (the default) and a candidate otherwise.
- **Shared loader.** The play area and the headless checks use one loader (`src/vfs.ts`). It runs in a `sandbox="allow-scripts"` srcdoc iframe fed by postMessage, and is kept as strings so bundler renaming cannot break it. The bridge stands in for `localStorage`; the panel keeps the saves per project in the browser.
- **Chrome.** The browser is the machine's installed Chrome (`chromePath`, then `CHROME_PATH`, then common install paths). `puppeteer-core` is loaded by dynamic import and kept in the dist through `dsh.runtimeDependencies`. With no Chrome found, only the data checks run, and the record says why the browser part was skipped.
- **Panel — the workbench.** Built on the panel kit; four views. Tab visibility uses the canvas dual check on the `@khorsheed/dsh-game/agent` row.
  - 试玩: the screen with its status strip (version, errors, pick, restart), the candidate bar (try / 退回 / 确认上线) and the parameter drawer.
  - 元素: a card grid, the pixel look editor, field editing, and the A/B/C proposals.
  - 策划: the one-pager and the pillars pinned on top, chapters expanding in place and editable, numbers charts generated from the elements.
  - 版本: the check layers with the headless screenshot, the timeline with rollback and diff, single-file export, the log. An art-style gallery serves both the home state and restyling.
- **Runtime contract the panel edits through.** The loader puts `game.json` `params` on `window.dshParams` and every element on `window.dshElements` before the game starts. Panel edits are pushed in by postMessage (`params`, `element`), so a game that reads them every frame changes live. The loader also provides `dshDraw`/`dshLookSize` for the pixel-row `look` format; `dshGame.pick(x, y)` enables 点选.
- **User layer, sent explicitly.** `.game/user.json` holds slider trial values (定稿 writes them into `game.json`), the changes not yet told to the agent, and a restyle request. Element edits land in the working file and in the live version's snapshot at once. The changes collect in a `conversation.input.dock` entry (面板改动), removable item by item. 「写进对话」 writes them into the composer as a message starting with `【面板改动】`; the user adds intent and sends. On `agent/pre-step`, a batch carrying that mark clears exactly the changes it lists; the batch itself is never modified. Unsent changes appear in `game_read`'s overview, so the agent does not revert them.
- **Look proposals.** `game_propose` stores up to 3 normalized variants (`.game/proposals.json`); the user's pick applies the look and becomes a pending change. A restyle request forces the next passing version to be a candidate.
- **Conversation rows.** A `uiConversation.events` Definition projects `dsh-game` messages into the `dsh-game-message` chat node kind, rendered by a keyed `conversation.chat.node` row: red 检查未通过 n/2 with the findings, grey 已附上 with the items. The official `context` node stays hidden, so nothing renders twice.

## Alternatives considered

**Attaching panel changes to the next send automatically.** Shipped first (proposal decision D3) and replaced on 2026-10-10 at the user's request. Every slider nudge rode whatever the user said next, even when the message had nothing to do with it, which was too fragmented. Telling the agent is now the user's explicit act. The cost is that the agent may not hear about a change; `game_read` listing the unsent ones covers the "do not revert it" case.

**A `game_write` / `game_check` tool.** Rejected (user decision). Different game types do not share one test method, and a check tool invites the model to skip it. Tests written with the code and run by the plugin at turn end cannot be forgotten.

**Depending on `@khorsheed/dsh-capture` for the browser.** Rejected. It is a cross-plugin edge outside the sanctioned pairs, and capture's queue and URL policy are built for capturing pages, not for running a game.

**Serving the game over a host HTTP route or a service worker.** Rejected in probe P0-1. Routes carry no auth, and desktop answers 403 for Origin null. The in-frame blob loader needs neither.

**`agent.followup` (a new turn) for failures.** Rejected. Steering keeps the fix inside the turn the user asked for. It also never overrides a user's stop, because `turn-stopping` does not fire on abort or error.

**Registering the hooks in the `./agent` entry.** Rejected. The core hooks act only on sessions with a binding, and only `game_open` binds, so the hooks stay inert outside the preset without depending on preset-plane event scoping.

## Consequences

- The workbench was walked on a second temp instance:
  - Sliders changed the running game and filled the panel-changes dock; 写进对话 + send cleared it.
  - Pick identified the keeper.
  - The fog wraith's look request produced 3 variants; picking B replaced the look in the game.
  - The design, versions and style gallery rendered in both wide and compact widths.
- The conversation row lands inside the host's step-process groups (`TURN_PROCESS_INDEPENDENT_KINDS` is a module constant, not extensible). After a turn ends they are visible only after expanding the turn and the step group. A host change is the way out; until then the dock and the 版本 view carry the same facts.

- Validated on a temp 0.2.0-rc.2 instance with a scripted model. One message created the project and wrote six files. The check failed in real Chrome (the keeper was too slow for the test), was steered back, and the agent read and fixed `rules.js`; the recheck passed and v1 played in the tab. A second turn deployed v2. A deliberately wrong test steered twice, then stopped with `gaveUp`, while the play area stayed on v2.
- The steered findings are context messages, which the 0.2.0 chat view hides. The user sees them only in the 检查 tab until the custom chat row (proposal option B, probe P1-8) lands in M2.
- Still out: SVG/vector looks in the editor, image-generation styles, itch.io publishing, leaderboards and multiplayer (server-side, a separate proposal).
