# @khorsheed/dsh-eval

English | [中文](README.md)

Put the agents on your machine (Codex, Claude Code, Kimi, dsh) through the same questions: you pick a question set and the groups to compare, it runs them, grades them, and lays the results side by side.

Wondering whether a kind of task goes better with another agent or another model used to mean opening terminals one by one, feeding questions by hand and comparing from memory, and by the next try the conditions no longer matched. With this plugin you tell the agent what you want to compare and it drafts an experiment; once you've looked it over and pressed "Approve and start", it hands each cell to the right agent, collects the answers, grades them, and keeps a record of every step. You end up with one results page: which group did better and by how much, and when there isn't enough data, it says so plainly ("no conclusion yet").

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-lab-list.png" width="640" alt="The experiments list, grouped into needs you / running / done; each card shows the dataset version, comparison groups, progress and one main button">

## What it does

- **Say what to compare and start**: press "New experiment" under Experiments, or just ask the agent; it drafts the question set, the groups and how many times each cell runs, and you edit and approve.
- **You decide when it runs**: the agent can only draft; "Approve and start" is yours to press. The run goes on in the background, even if you close the tab.
- **A dry run before the real one**: before the first real cell, each group runs one tiny task, so an expired login, the wrong model or a blocked network is caught early, with the reason shown.
- **Three rounds of grading**: the question set's own check scripts go first, a blind judge writes a first draft, and on the "Human review" page you read the answers side by side, without knowing which agent wrote which, and give the final verdict.
- **A verdict only when the comparison holds**: the "Results" page runs its "Validity checks" first; if conditions didn't match or there were too few runs, you get the facts and no ranking.
- **Every step on record**: how many tries each cell took, where it got stuck, what it produced; you can retry, and export the whole run for someone else to check.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-results.png" width="640" alt="The Results page: a verdict card and Validity checks 5/5 at the top, then each group's scores per criterion and the paired differences">

- **Cleaner comparisons in containers**: an experiment can run each cell in its own Docker container, with a per-cell record of whether the environments matched (handled by Lab).

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-human-review.png" width="640" alt="The Human review page: several answers to one question, with their source hidden, side by side; each column has its criteria, judge A / B's first take and score inputs">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-eval-suite
```

Eval comes with the Evaluation Suite, along with datasets and the connectors for each agent. Then start a new session, pick the 「评测模式」 (eval mode) preset, and tell the agent what you want to compare; or create an experiment straight from Experiments in the left sidebar.

The in-session eval tools only appear in eval mode; not seeing them in other modes is expected.

## Known limitations

- A stopped experiment can't pick up where it left off; you start it again from the same design, and the old run stays as a record.
- In containers, cells run one at a time, so it is slower.
- The pages are web-only; in the terminal you only get the `/eval` command.

## Compatibility

Needs DSH 0.2.0-rc.2 or later; verified on 0.2.1-rc.1. How it degrades when a host capability is missing is in the [reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/eval/docs/reference.en.md#compatibility-degraded-and-absent-items).

## For developers

- Entry points: `src/index.ts` (the orchestrator, `/eval` and the `dsh-eval` CLI) and `src/tool.ts` (the agent's tools); the mission ledger lives in `src/mission/`. In depth: the [orchestration and judging reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/eval/docs/reference.en.md), the [UI reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/eval/docs/ui.en.md) and the [mission ledger](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/eval/docs/mission/README.en.md).
- You can install it alone (`dsh plugin --profile web add @khorsheed/dsh-eval`), but a run needs datasets (`@khorsheed/dsh-datasets`) and the local-agent family present, and refuses by name if one is missing; the agent's tools must be granted by a mode.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
