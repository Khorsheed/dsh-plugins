# Changelog

## 0.1.0 (unreleased)

- Turn card in the conversation's turn tail (outside the fold): what the turn changed, with jumps into the tab; host-side turn baselines diffed at turn/end.
- Sliders are trials only (no pending change); "Tell the agent" writes the trial values into the composer.
- After a change the panel asks whether to tell the agent (write into chat / not this one / later / stop asking).
- Play is opt-in: a poster and a Play button, Stop while running.
- Host look: the host's Switch and Tag primitives, Button-styled actions, neutral chips.

- Panel changes are no longer attached to the next send automatically: they collect in the "Panel changes" dock, "Write into chat" puts the list into the composer, and a sent message carrying it clears what it lists (`agent/pre-step` no longer touches the batch). Unsent changes show in `game_read`.
- Project switcher: the title opens project cards (screenshot, version, style, elements, last change, pitch) led by a New project card.

- The Game tab becomes a game-design workbench (M2/M3 of the proposal): parameter drawer with live sliders, finalize/reset; element card grid, pixel look editor, field editing, `game_propose` 3-variant look proposals picked in the panel; one-pager and pillars pinned in the design view with in-place chapter editing and numbers charts; versions timeline with candidate confirm/reject, rollback, diff and single-file export; art-style gallery and restyle-as-candidate; pick-in-game; panel changes auto-attached at the next send with a "will attach" dock above the composer; collapsible conversation rows for check findings and attached changes.

- First version (M1 of proposal 2026-10-09-gamedev-mode): projects in the session workspace behind a light gate, `game_open` / `game_read`, the `gamedev` and `game-design` skills, the right-sidebar Game tab (play / design / elements / checks), and the end-of-turn checks (data validation, headless smoke run, the project's own test scripts) that steer failures back into the same turn at most twice and deploy passing versions.
