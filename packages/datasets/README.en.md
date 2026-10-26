# @khorsheed/dsh-datasets

English | [中文](README.md)

> **Still being polished — not released yet.** This plugin can't be installed from Plugins → Add plugin for now, and what follows may change.

Turn questions scattered across folders into a dataset an evaluation can use: the version is pinned, and the answers and grading rules never leak to the agent being tested.

Two things ruin an evaluation: the questions quietly change, so two rounds weren't really answering the same set; or the answers and grading rules end up where the player can see them. With this plugin you tell the agent which folder holds the questions, and it organizes them into a dataset, runs the checks, and hands it to you; only after you've gone through it and pressed "Confirm registration" does it count. From then on each experiment is pinned to the registered version, and the player only gets the parts you allowed.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-panel.png" width="560" alt="The Datasets panel in the left sidebar: datasets grouped by source, with the latest version, question count, what the agent can see and which experiments use them">

## What it does

- **Point at a folder and it gets organized**: in Datasets, press "Add a dataset" and choose "Let the Agent organize it"; a new session opens where the agent shapes the raw data into a dataset and asks to register it.
- **Nothing is registered until you say so**: the review page shows the original folder and the dataset side by side, with a visibility switch for each part; press "Confirm registration" if it looks right, or "Send back to the Agent" if not.
- **See at a glance who sees what**: each question's page lists "What the player will see" next to "Only judges and probes see", so an answer in the wrong place shows up right away.
- **Changes don't slip in**: when the source moves on, changes the player can't see follow along on their own; changes the player can see are marked "new version to confirm", and experiments keep the old version until you confirm.
- **Checked for gradability first**: before registering, it checks that every question has grading rules and that objective ones have a check script; problems are flagged, not blocking.
- **Also inside eval sessions**: the same view lives in the Datasets panel in the left sidebar and in an eval session's Datasets tab.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-review.png" width="560" alt="The review page waiting for your confirmation: original folder and dataset side by side, visibility switches per part, and the Confirm registration and Send back to the Agent buttons">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-item-detail.png" width="560" alt="A question's detail page: a file tree colored by visibility on the left; on the right, what the player will see next to what only judges and probes see, and a line saying whether it can be graded">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-eval-suite
```

Datasets comes with the Evaluation Suite. Then open Datasets in the left sidebar and press "Add a dataset"; or start a new session, pick the 「评测模式」 (eval mode) preset, and ask the agent to "turn the questions in this folder into a dataset".

The in-session dataset tools only appear in eval mode; not seeing them in other modes is expected.

## Known limitations

- Datasets live in git repositories, and only committed files are visible; the agent commits before it asks to register.
- Each new version of a source may leave behind another read-only copy, which isn't cleaned up automatically.

## Compatibility

Needs DSH 0.2.0-rc.2 or later; verified on 0.2.1-rc.1. How it degrades when a host capability is missing is in the [reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/datasets/docs/reference.en.md#compatibility-details).

## For developers

- Entry points: `src/index.ts` (the service, `/datasets` and the `dsh-datasets` CLI, the sidebar) and `src/tool.ts` (the agent's tools). Repository layout, check rules and tool tiers are in the [reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/datasets/docs/reference.en.md).
- You can install it alone (`dsh plugin --profile web add @khorsheed/dsh-datasets`); storage, registration and checks aren't tied to evaluation. The agent's tools must be granted by a mode.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
