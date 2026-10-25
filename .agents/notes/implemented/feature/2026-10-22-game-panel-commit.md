# Agent Note: panel edits commit as versions; element lore

Status: implemented

## Problem

On 2026-10-22 the user walked the 3D project's element pages and found the panel's model of "a change" confusing. An element edit wrote the working file and patched the live version's snapshot in place, so the play area changed without a new version. A dock above the composer and a nudge after every change then asked the user to "tell the agent", which read as if the edit did not count until sent. Finalizing slider values wrote `game.json` but not the live version and cleared the trial values, so the play area fell back to the old values until the agent's next turn cut a version. On the element page, "ask the agent for a new look" sat below a long column of recipe sliders. And an element had looks and numbers but nowhere to say who it is, although its behavior (a beast that startles, grows curious, comes closer) comes from exactly that.

## Decision

- **Edits change the working files; versions come from a commit.** `editElement` writes only the element file. Each edit is listed in the user layer's `edits` (key per element and kind, text such as 「毕方的外观」). A bar above the tabs lists them and commits them (since 2026-10-24 the same bar covers every working change and reads 「有新改动还没进游戏 · 检查并发版」, see [the changes bar](2026-10-24-game-changes-bar.md)). The `commit` Remote runs the same `checkRow` pipeline as a turn's end (no fix cap, nothing steered). A pass cuts a version noted 「面板修改：…」 (deployed, or a candidate when auto-confirm is off). A failure stays in the bar with 「交给 agent 修」, which writes the findings into the composer. A build the last check already passed answers `unchanged`. Whatever cuts the next version (the commit, `game_publish`, or a turn's end) writes the outstanding edits into its note and clears them.
- **Finalize commits.** 定稿 writes the defaults into `game.json`, records an edit, and the panel commits at once. The play area moves to a version that has the new values.
- **No "tell the agent" prompts.** The composer dock (`conversation.input.dock`), the post-change nudge and its header switch, and the 「未发送改动」 tag are gone. The agent-facing `pending` list stays. The `game_read` overview lists it once and then clears it. The skill tells the agent that panel edits are the user's decisions and that it should `game_read` before rewriting element files or `game.json`. 「告诉 agent」 on the slider drawer stays, because it is the user's explicit feedback.
- **Lore (设定).** Every element may carry a `lore` string. It is shown and edited in a 设定 card on the element page, kept out of the stats and field editor, capped at 2000 characters from the panel, and collected into a generated 元素设定 chapter. `game_read element` shows it, and the skill asks the agent to write lore for every element and follow it for behavior and wording.
- **Element page order.** Preview → ask for a new look and its proposals → 设定 → the 3D recipe folded under 细调外观 → fields. The play frame no longer receives element hot-swaps; the spin preview still follows edits live.

## Alternatives considered

**Keep live edits and only reword the dock.** Proposed first. The user preferred an explicit commit: a change the play area shows should be a version, so the timeline, the turn card and rollback all see it.

**Commit per edit automatically.** Every slider or stroke would run the browser checks and add a version, which floods the timeline and makes a half-finished look playable. The bar batches edits, and the user decides when they make a version.

**Lore as a design chapter only.** One file for every element is easy to write but far from the element page where the user looks at the model; per-element lore keeps it beside the look, and the chapter is generated from it.

## Consequences

- Elements edited in the panel are not playable until committed. The bar is the reminder, and an agent version folds them in anyway.
- A commit checks the whole working tree, so an agent's half-written files can fail it. The failure stays in the bar and can be handed to the agent.
- The agent learns about panel edits only through `game_read`, with no forced message. The skill rule and the version notes ("面板修改：…") carry the rest.
- Supersedes the explicit-send user layer in [game-dev mode](2026-10-09-game-dev-mode.md); the 2026-10-10 decision against automatic attachment still holds, because nothing is slipped into the user's messages.
