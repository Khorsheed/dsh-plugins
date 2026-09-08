# Agent Note: the container path mounts the instance's own scoped home, and the judge is probed like everyone else

Status: implemented

English | [中文](2026-09-08-eval-scoped-home-and-judge-readiness.zh.md)

## Problem

Two failures that both look like success.

**The scoped home was mounted from the wrong place.** T20 had the container path mount `<--creds-root>/<condition id>` — a staged tree — while the local-agent family's read-back reads `homeDir(<harness>)`, `<homesRoot>/<harness>`. A containerized round's CLI writes its rollout (codex), wire log (kimi) or session log (sub-dsh) into whatever was bound; the read-back looks somewhere else. Nothing errors. The round completes, the cell archives, and every `model.observed` is null forever: readiness reports `ready, model —`, and «受试对象一致» never leaves ⚠️. T22 only got a ✅ by pointing its driver's `homeDir` at the credential directory by hand — a lever the product path does not have. The root cause is that T20's text drifted from T17's decision, which was: *the scoped home stays a HOST directory, bind-mounted read-write, and the read-back reads it directly*. One directory, not two.

**The judge was never probed.** T23's readiness check covers the player conditions. A judge is the same kind of thing — a real delegation that can fail on a credential reporting `authenticated` — and its failure is dearer: a player that cannot be delegated to loses its own cells, a judge that cannot be delegated to loses the whole round's llm-draft verdicts. Pilot B lost both judge samples and the run still walked to `released` with an empty namespace.

## Decision

- **The mount source is `localAgent.homeDir(harness)`.** The container path binds the evaluation instance's own scoped home for that harness at the container path the condition declares. It is the directory `/<harness> login` writes into and the directory the read-back parses, so a containerized round's own traces land where the read-back looks. `--creds-root` is deleted outright — from the slash face, the CLI, the READMEs and the protocol's operating notes. Condition files do not change: they still declare only the in-container path and the variable.
- **Credentials arrive by logging in on the instance, not by staging a copy.** Nothing is copied, so nothing can drift; a refresh the CLI performs inside the unit lands on the host directory the next round reads. When a grant expires, log in again on that instance.
- **A facade without `homeDir` is a refusal that names it.** Mounting some other directory instead is exactly the failure this note is about, and it is invisible — so the container path refuses rather than falling back.
- **The judge conditions are probed too**, on the same rule, with the same refusal, recorded in `run.meta.readiness` with `role: 'judge'` beside the players' `role: 'player'`. `--ignore-readiness` skips it like any other, and a failed judge skips no cell — it has none.
- **The judge is probed on the HOST even in a container run.** Judging delegates from the orchestrator, not from a cell; probing it inside a unit would test an environment it never meets. The readiness check's `unitFor` hook may now decline a unit, and declining is what the run loop does for a judge.
- **Read-back is untouched.** The container round settles through the same `homeDir` path it always did; it simply finds something there now.

## Real-machine verification

The evaluation instance's own scoped homes (`~/.dsh-lab/local-agent/<harness>`), the T22 image on `eval-net` as user `1000`, a real codex CLI inside the unit — the T22 driver shape, with its hand-patched `homeDir` removed because the product path now supplies it.

**One cell, P0 × codex, container path, to `released`:**

```
[run] readiness codex-exec: ready (7.7s, model gpt-5.6-sol)
```

`model gpt-5.6-sol`, not `model —`. The report's four invariants:

```
- **题面一致** — ✅ 成立 · P0-placeholder: 8b38bb4698fa… × 1 格一致
- **环境一致** — ✅ 成立 · 1 格指纹一致: lab-env:0fcb…
  -   …codex-exec-rep1: lab-env:2e02ebee9261… — 排除 挂载 /creds/codex、env CODEX_HOME
- **受试对象一致** — ✅ 成立 · 模型回读与声明一致
- **程序一致** — ✅ 成立
```

All four, and `comparison allowed` — the first run in this project's history where the report is willing to compare anything.

**A judge that cannot be delegated to refuses the run:** the same plan with `judge.conditions: ["claude-exec"]`, whose OAuth grant on this instance is expired. The player passed and the judge did not, and the run never got created:

```
EvalRunRefused: 1 of 2 condition(s) failed the pre-run readiness check — nothing was executed
  code: 'READINESS_FAILED',
  message: 'judge claude-exec (harness claude-code): the probe exceeded 120s and was cancelled'
```

Before this, that plan reached `released` with two dropped judge samples and an empty llm-draft namespace.

## Alternatives considered

**Keep `--creds-root` and teach local-agent to read back from it.** Rejected: it inverts the ownership. The scoped home is local-agent's — it provisions it, `login` writes it, the providers read it — and having the orchestrator name a different directory for the same purpose is what produced two directories in the first place. One owner, one directory.

**Copy the instance's scoped home into a staging tree per condition.** Rejected: a copy is a second source of truth for a credential that REFRESHES. A refresh inside the unit would land on the copy while the host kept the stale one, or vice versa; the failure would be an expiry nobody could explain. It also does not solve the read-back, which reads the harness's home whatever the mount is.

**Give each condition its own scoped home so two conditions of one harness can differ in it.** Wanted, not available: overriding the scoped home per delegation is I4's T29. Until then two conditions of one harness share a directory and can only differ in factors that do not live in it (model, reasoning effort). Said plainly in the README rather than papered over — a run that needs two different logins of one harness cannot be expressed yet.

**Probe the judge inside a unit on the container path, for symmetry.** Rejected: symmetry with what? Judging runs on the host, so a unit probe would prove the credential works somewhere the judge never runs — the same mistake, one level up, that made the player probe move INTO a unit in the first place.

**Make a failed judge a warning rather than a refusal.** Rejected: the cost of continuing is the whole round's llm-draft verdicts, discovered after every cell has been paid for. `--ignore-readiness` already exists for the operator who means it.

## Consequences

- «受试对象一致» is reachable on the container path, and with it the report's first `comparison allowed`.
- Two conditions of the same harness share one scoped home until T29. A plan that needs otherwise has no way to say so today, and the README says which iteration fixes it.
- A run whose judge is down stops before the run record exists, which costs the operator a re-run of the readiness probes (seconds) and saves the round's judging.
- `--creds-root` is gone rather than deprecated: it named a directory that must not exist, and leaving it accepted-but-ignored would keep the wrong mental model alive.
- The protocol's condition-schema description changed with it (v1-rev7): the host side of `unit.scopedHome` is the instance's own scoped home, not a staged root.
