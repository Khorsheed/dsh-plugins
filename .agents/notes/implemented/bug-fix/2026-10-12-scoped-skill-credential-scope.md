# Agent Note: credential hint and injection read past the catalog's own scope

Status: implemented

## Problem

Two catalog reads used the catalog's settings scope (the default preset's standing scope) as if it were the reader's view. Once [preset-scoped delivery](../../proposed/feature/2026-09-13-capability-catalog-preset-scoped-skills.md) existed, a skill scoped to a non-default preset — weread-skills scoped to learning — is invisible at that scope, so (1) the `skill`-load env hint never fired for it (the model was never told its configured credential exists), and (2) the shellEnv contributor's refresh never saw its declared keys, so `DSH_WEREAD_API_KEY` was never injected anywhere. Observed on 3080: a configured, delivered, loadable skill whose model answered "the key is not set".

## Decision

The env hint reads the loaded skill at the CALLER's scope (`exec.agent` — the same read position the `skill` tool itself uses), falling back to the catalog scope only when no agent is on the execution. The shellEnv contributor additionally scans the managed root directly (`scanManagedSkills` + `definitionFor`), folding preset-scoped skills' declared keys into the injected set alongside the registry-snapshot set.

## Alternatives considered

**Iterate every roster preset and union the snapshots.** Rejected: more roster coupling for the hint, when the caller's scope is the one honest read position; and for injection, the managed-root scan covers exactly the scoped-delivery gap without enumerating presets.

**Scope the injected variables per execution.** Rejected as out of proportion: preset scope is a discovery/delivery policy, not a secret boundary (the delivery module docblock says so), and a value leaves the env only if a command prints it.

## Consequences

A skill scoped to any preset now gets its credential hint at load and its `DSH_<KEY>` injection instance-wide. The refresh chain gained real filesystem reads, so the shellEnv spec's microtask flushes became a wall-clock `settle` helper; the two fake-timer boot-window tests advance the retry on fake time, then settle on real time.
