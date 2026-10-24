# Changelog

## 0.1.0（2026-10-24）

- The panel bar covers every working change — panel edits, the agent's, a CLI member's, the user's editor — with 检查并发版 (disabled while a turn runs or a file changed in the last 20 s); it polls while visible. Versions record who published (you / the agent / turn end). The skill, guidance and personas: publish before reporting or asking, and publish for CLI members.
- 3D scenes: `world.enterScene(name, setup)` swaps terrain, the scene's own style overrides (`game.json` `style3d.scenes`, kept through panel rewrites) and everything registered inside, freeing the last scene. A new `terrain()` replaces the old ground.
- `world.scatter(element, countOrPoints, { seed, … })`: one look instanced over the ground, each copy on the terrain with a seeded facing and size, outlined, and pickable as `id#n`.
- Inside the checks `step` advances logic without rendering; the 3D blank probe renders once.
- Skill: `assets/` (formats, limits, textures, canvas textures), scenes, scatter; glTF looks are stated as stand-ins for now.
- Every visible element carries a look, scenery included: the skill asks for a look on everything visible, and in 3D scenery shapes are registered with `defineBase` in `src/looks.js`, scattered with `world.scatter` (or built one by one), so the element grid can render and tune them.
- Panel edits (looks, fields, lore, picked variants, finalized params) change the working files; a bar commits them as a new version through the checks. The composer dock, the post-change nudge and its switch are gone; `game_read` shows the agent what changed once.
- Element lore (`lore`): a 设定 card on the element page and a generated 元素设定 chapter. The element page puts "ask the agent for a new look" under the preview and folds the 3D recipe.
- Element cards show a 3D element's model as a still (two render at a time; the color swatch stands in meanwhile). The open element's title row is the panel kit's header — a real back button, pinned while the detail scrolls.
- `game_publish`: run the checks and cut a version mid-turn. A question does not end the turn, so the skill and the mode persona require a green publish before the agent asks the user to play.

- The one-pager has one source (`game.json`), edited on the design card; `design/pillars.md` becomes 支柱说明 (pillar notes only), lines restating the one-pager are filtered out.

- Turn card in the conversation's turn tail (outside the fold): what the turn changed, with jumps into the tab; host-side turn baselines diffed at turn/end.
- Sliders are trials only (no pending change); "Tell the agent" writes the trial values into the composer.
- After a change the panel asks whether to tell the agent (write into chat / not this one / later / stop asking).
- Play is opt-in: a poster and a Play button, Stop while running.
- Host look: the host's Switch and Tag primitives, Button-styled actions, neutral chips.

- Panel changes are no longer attached to the next send automatically: they collect in the "Panel changes" dock, "Write into chat" puts the list into the composer, and a sent message carrying it clears what it lists (`agent/pre-step` no longer touches the batch). Unsent changes show in `game_read`.
- Project switcher: the title opens project cards (screenshot, version, style, elements, last change, pitch) led by a New project card.

- The Game tab becomes a game-design workbench (M2/M3 of the proposal): parameter drawer with live sliders, finalize/reset; element card grid, pixel look editor, field editing, `game_propose` 3-variant look proposals picked in the panel; one-pager and pillars pinned in the design view with in-place chapter editing and numbers charts; versions timeline with candidate confirm/reject, rollback, diff and single-file export; art-style gallery and restyle-as-candidate; pick-in-game; panel changes auto-attached at the next send with a "will attach" dock above the composer; collapsible conversation rows for check findings and attached changes.

- First version (M1 of proposal 2026-10-09-gamedev-mode): projects in the session workspace behind a light gate, `game_open` / `game_read`, the `gamedev` and `game-design` skills, the right-sidebar Game tab (play / design / elements / checks), and the end-of-turn checks (data validation, headless smoke run, the project's own test scripts) that steer failures back into the same turn at most twice and deploy passing versions.
