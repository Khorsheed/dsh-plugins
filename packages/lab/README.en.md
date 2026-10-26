# @khorsheed/dsh-lab

English | [中文](README.md)

Run every cell of an evaluation in its own Docker container: the same environment each time, no cross-talk, cleaned up afterwards, and a way to prove the environments really matched.

A comparison is meant to compare agents, not environments. Run the same questions through several agents a few times each, and if one cell had an extra folder mounted, a different network or a different memory limit, the results stop being comparable, and that kind of difference is hard to spot afterwards. With this plugin you just set the experiment to run in containers: it opens a clean container for each cell, puts the question in, lets the agent work inside, collects what it produced, and removes the container once the checks pass. Every cell ends up with an environment fingerprint, and matching fingerprints mean the environment really was the same.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-record-env.png" width="560" alt="A run record's details in Experiments: the environment fingerprint and container unit in the parameter table, matching the other cells of the same run">

## What it does

- **A clean container per cell**: one container for each cell, nothing leaks between them; each is cleared away when its cell is done.
- **One fingerprint tells you if environments matched**: the image, resource limits, mounts, network and user all go into it, shown per cell under "Run records"; whatever is declared is really applied to the container.
- **Failures keep their evidence**: when a cell crashes, its output and state are collected and archived first, then that cell alone gets another try.
- **Nothing is removed before it's checked**: a container is only destroyed after its cell's record has been checked, so results you haven't collected aren't thrown away with it.
- **Survives a restart**: when DSH restarts, containers still running are picked up again.
- **Leftovers in plain sight**: containers not yet removed are listed under "Unreclaimed units" on the Results page; press "Reclaim" to clear them.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-run-units.png" width="560" alt="The Unreclaimed units section of the Results page: the containers this run still holds, the state of each one's cell, and a Reclaim button">

## Install

In DSH, open Plugins → Add plugin, enter this package name, and press Install:

```
@khorsheed/dsh-eval-suite
```

Lab comes with the Evaluation Suite. It has no screen of its own; what it records shows up in eval's Experiments pages. Your computer needs Docker, with `docker` working on the command line. Then start a new session in 「评测模式」 (eval mode) and, when the agent drafts the experiment, ask it to run each cell in a container.

## Known limitations

- Docker is the only option for now.
- The fingerprint records the configuration you declared, not the measured machine: it can't tell two computers' CPUs or kernels apart. To guarantee no internet access, declare an offline network in the experiment.
- The image you use needs `sh` and `sleep`.

## Compatibility

Needs DSH 0.2.0-rc.2 or later; verified on 0.2.1-rc.1. How it degrades without the mission ledger is in the [reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/lab/docs/reference.en.md).

## For developers

- Entry points: `src/index.ts` (provides the `ctx.lab` service) and `src/cli.ts` (the `dsh-lab` CLI; `dsh-lab status` lists every unit), both on top of `src/service.ts`. The service interface, fingerprint components and failure recovery are in the [reference](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/lab/docs/reference.en.md).
- You can install it alone (`dsh plugin --profile web add @khorsheed/dsh-lab`) for any comparison that needs isolated, matching environments; without the mission ledger (installed with `@khorsheed/dsh-eval`), removing a container needs an explicit `force`.
- Part of [dsh-plugins](https://github.com/Khorsheed/dsh-plugins); open issues and contributions there. Changes: [CHANGELOG.md](CHANGELOG.md).
