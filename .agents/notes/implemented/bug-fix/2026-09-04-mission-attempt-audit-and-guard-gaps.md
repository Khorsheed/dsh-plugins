# Agent Note: mission — explicit submit intent and auditable retries

Status: implemented

English | [中文](2026-09-04-mission-attempt-audit-and-guard-gaps.zh.md)

## Problem

A manual run using a branching state machine exposed two guard gaps. Submit-time validation conjoined every submission-input schema edge leaving the current state, so mutually exclusive branches could make every payload invalid even though the eventual transition had one valid guard. A `file-check` directory expectation proved only that a directory existed, allowing an empty archive section through. Separately, a retry opened a new attempt without recording why, namespace-completeness output did not expose which interface wrote each namespace, and an out-of-process CLI could not share a host instance's non-default data root without repeating the path on every invocation.

These are mission-level mechanism gaps: the package must remain generic and cannot learn the scene vocabulary that happened to reveal them.

## Decision

`submit` accepts an optional intended target, `to`. Its pre-validation selects only that declared outgoing edge. Without `to`, the previous convenience remains when zero or one submission-input schema edge leaves the current state; several such edges are a usage error that lists every candidate. The intended target is not stored and does not move the mission. `transition` still resolves the actual declared edge and re-runs its guard, so submit-time selection cannot bypass state-machine enforcement. The service, model tool, and CLI `--to` adapters share this service-core decision.

A `file-check` entry ending in `/` now means a directory that recursively contains at least one regular file. A missing path or wrong kind is reported as `missing`; a directory tree with no regular file is reported as `empty`. Recursive checking permits ordinary nested archive layouts while refusing placeholder directory trees.

Every retry requires a non-empty free-text `reason` and one domain-neutral category from `infrastructure`, `operator`, or `outcome`. The fresh attempt carries a `retry` record (`reason`, `category`, `at`, `by`) and starts its history with the same data as a `kind: retry` event. Initial attempts and old run files have no `retry` member and remain readable. The model tool and CLI require both fields; the existing slash and web-tab entry points collect and forward them too, so no mounted face can create an unaudited attempt.

Namespace completeness adds a `writtenBy` map per cell: every expected or present namespace maps to the sorted, deduplicated origin prefixes of its current-attempt annotations. Colon-bearing callers normalize through the first colon (`tool:session` to `tool:`, `slash:session` to `slash:`); plain origins such as `cli` and `service` remain unchanged. Missing expected namespaces map to an empty list. Run status renders these facts and export embeds them in `manifest.json`; no policy conclusion is inferred from a namespace written only by tools.

The CLI resolves its root in this order: `--data-dir`, `DSH_MISSION_DATA_DIR`, `DSH_HOME/state/mission`, then the current working directory fallback. Host plugin config deliberately does not read `DSH_MISSION_DATA_DIR`: an instance patch is process configuration and is invisible to a separately launched CLI, so sharing a custom root is an explicit CLI concern.

## Alternatives considered

**Skip submit-time validation whenever a state branches.** Rejected because it would write a payload already known to violate the selected path and defer useful feedback until transition. Explicit intent preserves the early no-write failure.

**Try every schema and infer the target from the one that passes.** Rejected because overlapping schemas can produce several matches, schema evolution can silently change the chosen path, and a payload should not move or imply state by inference. The caller already knows the intended edge and names it.

**Attach the retry reason to the previous attempt only.** Rejected because the reason explains why the new attempt exists. Keeping it on the new record makes an exported attempt self-describing; the history event provides the normal chronological audit view.

**Require a file directly inside each expected directory.** Rejected because archive sections commonly nest their files. The contract is non-empty recursively, while symlinks and special entries do not count as regular files.

**Flag or reject namespaces written only through a model tool.** Rejected because mission owns provenance, not trust policy. `writtenBy` reports the fact and leaves interpretation to the consumer.

## Consequences

- Existing single-schema templates retain their submit behavior; branching templates must add `to` at submit time and keep their guards on every branch.
- Retry is intentionally still non-idempotent. Repeating the same reason and category opens another attempt, but every such attempt is now attributable and explainable.
- The run JSON change is additive. Readers see legacy attempts without `retry`; writers add the field and retry history event only to new attempts.
- A previously accepted empty directory now fails its transition guard. Nested regular content passes without requiring a new template field or dependency.
- Export consumers gain `writtenBy` without losing the existing `present`, `expectedPresent`, `missing`, or `onlyUnlisted` fields.
- A custom instance `dataDir` and CLI remain decoupled unless the operator sets `--data-dir` or `DSH_MISSION_DATA_DIR` to the same path.

## Testing

`packages/mission/tests/state-machine.spec.ts` reproduces the branching template with both schema guards restored: the positive branch submits with `to`, omission lists both candidates, the negative branch submits with its own target, the transition guard re-checks each payload, CLI ambiguity exits as usage, and an empty then recursively populated directory proves the strengthened file guard. Service, CLI, tool-adapter, slash, Remote, and client tests cover mandatory retry metadata and attribution. A raw legacy run fixture proves old attempts without the additive fields still load and accept a new retry. Export tests cover missing and tool-only writer sets in both run-status text and the export plan/manifest data.

The mission build and all 124 mission tests pass; the source-vocabulary check and `git diff --check` are clean. `pnpm gate` passes steps 1–8 (including full hygiene, plugin independence, bilingual-document checks, script tests, and the repository build) but stops at step 9 because existing `ankh-guard` watchdog tests fail. The consistently failing composition-recovery case reproduces unchanged on local `main` at the worktree's base revision, so it is recorded as a pre-existing repository-gate blocker rather than changed in this mission patch.

## Cross-references

- [Mission task proposal](../../../proposals/active/2026-08-19-mission-tasks.md) — the state-machine, attempt, interface, and namespace-integrity contracts refined here.
- [Mission export note](../feature/2026-08-19-mission-m2-export.md) — owner of the completeness report and manifest shape extended by `writtenBy`.
- [Mission slash note](../feature/2026-08-19-mission-m2-slash.md) and [mission tab note](../feature/2026-08-19-mission-m4-tab.md) — existing faces updated so the service's mandatory retry contract remains usable.
