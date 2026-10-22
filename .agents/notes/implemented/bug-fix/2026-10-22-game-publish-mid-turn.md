# Agent Note: publishing a game version mid-turn

Status: implemented

## Problem

A version reached the play area only through the end-of-turn checks (`agent/turn-stopping`). In game-dev mode the agent often builds something, then asks the user to try it with `ask_user_question` — and a question does not end the turn. On 2026-10-22 a 3D session ran a single 22-minute turn with 13 questions in it; the agent told the user to "play for a minute" while the play area still said there was no playable version, because no check had ever run (the project had no `.game/` folder at all). The persona prompt made it worse: it told the agent not to deploy and that the checks happen "when your turn ends".

## Decision

- A fourth model tool, `game_publish`, runs the same `checkTurn` pipeline on demand: data validation → headless load and 2-second smoke run → `tests/*.test.js`. A pass cuts a version into the play area (or a candidate when auto-confirm is off or for a restyle); a failure lists the findings; an unchanged build answers from the last check without re-running it.
- It calls `checkTurn` with no fix-round cap, so an explicit publish never marks a build "given up"; the end-of-turn loop still checks (and steers) a build that failed a publish. A build that passed a publish is skipped at turn end by the existing fingerprint check.
- The rule lives in the prompt layers: the `gamedev` skill, the `game-agent` guidance section and both copies of the `dsh-gamedev` persona (`packages/gamedev`, `packages/presets`) require a green `game_publish` before the agent asks the user to play or try anything, and say that pure design questions need none.

## Alternatives considered

**Check and publish automatically before every `ask_user_question` (a `tools/pre-execute` hook).** Needs no model cooperation, but the agent often asks while files are half-written; the hook would either run the checks for nothing or block a design question with failures that are not relevant to it. Rejected in discussion with the user; reconsider if agents keep forgetting the rule.

**Let the agent verify playability itself (a headless browser via bash) under a prompt rule.** Even a correct self-check cannot cut a version — only the plugin snapshots, numbers and deploys — so the play area would stay empty, which is the observed failure. It would also make every agent build its own browser harness.

**Only reword the prompt to "end the turn before asking to play".** Ending the turn to ask breaks the ask-and-continue flow the user likes, and it leaves the agent no way to ship a version and keep working.

## Consequences

- Delivery depends on the agent following the rule; the end-of-turn check stays as the backstop for whatever the turn left behind.
- Checks may now run mid-turn several times; each run costs a headless load per test file (seconds for a small game).
