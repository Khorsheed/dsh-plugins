# Agent Note: the eval judge — the probe contract, blind LLM judging, and closing the archive gate

Status: implemented

English | [中文](2026-09-07-eval-judge.zh.md)

## Problem

The orchestrator (T8) drove a cell to `judged` and stopped at `archived` with an empty `verdicts/`. That emptiness was not cosmetic: mission's G2 file-check refuses an empty directory, so `--finalize` could never reach `released`, and the report's judge-consistency column had nothing to count. More fundamentally, a benchmark that produces no verdicts is not a benchmark — every claim about "which harness did better" was still waiting on a human reading four files per cell.

The flow declares three verdict sources with three different authors: `script` (deterministic probes), `llm-draft` (a judge condition), `human-final` (a person). The two mechanical ones had a shape in the protocol and no mechanism anywhere. Worse, the LLM one is the source most easily done wrong: a judge that is also a contestant grades itself; material that still says "I am Codex" turns a blind evaluation into a branded one; and a single sample reports an opinion as if it were a measurement.

## Decision

`packages/eval` gains `src/judge.ts` and a judging phase in the run loop, running after a cell parks in its terminal stage state and BEFORE the archive copy — the verdicts are part of what gets archived, which is what the gate is checking for.

- **The probe contract is now protocol (§6.7), not convention.** A probe is any `.mjs` / `.sh` under a `probes/` segment of the item's verify layer, invoked `<probe> --cell <cell dir> --rubric <rubric> --out <verdicts.json>`. **The exit code carries one bit and only one**: `0` means judged — `pass: false` included — and non-zero means the probe itself failed. The third case decided the design: exiting `0` without a readable `--out` is classified as a probe FAILURE, not an empty verdict, because a probe that claims a judgement and produces nothing checkable is broken in exactly the way silent success hides. The whole verify layer is materialized into a host-side temp directory used as the cwd (probes read their checklist and helpers by relative path, as in the repo) and removed afterwards; I3 moves execution into the container behind `lab.verify` with the contract unchanged.
- **De-fingerprinting is a table, and the table is evidence.** Harness names, CLI names and self-reported assistant names become `<harness>`; every model identifier the plan's conditions declare (or the delegations read back) becomes `<model>`. Rules are sorted longest-literal-first so `deepseek-chat` is consumed before `deepseek` and `claude-code` before `claude`. Match boundaries are spelled out rather than `\b`, so `dsh-eval` and `(dsh)` are hits while `wordsh` is not. The replacement table with per-pattern counts lands in the orchestrator ns, and the cell's own files are never rewritten — the judge sees a copy, and a reviewer can check what was hidden from it.
- **The judge is a condition, delegated like a player, and must not be one.** `plan.judge.conditions` names it; `plan.judge.samples` (default 2) sets the sampling. Beyond validate's existing id-intersection check, the run refuses before executing anything when a judge's `(harness.name, model.declared)` equals any player's — two different ids naming the same subject is still a judge grading itself, and the refusal names the player it collided with. Each sample is a FRESH delegation in its own cwd: resuming would show the judge its own previous answer and destroy the independence the second sample exists to provide.
- **The prompt is assembled, never carried.** It is the `kind: llm-draft` rows of the item's grading-layer rubric — `objective` rows belong to the probes and `human` rows to the judge bench, and neither is shown — plus the de-identified material plus the output contract. An unreadable `verdicts.json` is recorded and retried exactly once; a second failure drops that sample rather than inventing one.
- **`task` and `by` are the orchestrator's, not the judging side's.** Both probes and judges have their values overwritten after validation, while `criterion` / `pass` / `evidence` are left alone. The report keys rows by task and prints `by` as the origin; a probe or judge that mislabels either would corrupt every join downstream, and neither has any information the orchestrator lacks.
- **Judging cost is `kind: 'judge'`, never `kind: 'delegation'`.** The report's efficiency table reads `delegation` and nothing else, so the judge's usage and duration are recorded in full without being charged to a contestant.

`report.ts` learned one thing: a verdict annotation payload may be the orchestrator's SAMPLE ENVELOPE — `{sample, judgeCondition, judgeSha, promptSha, verdicts}` — alongside the bare verdict and bare array it already read. Keeping provenance beside the verdicts (rather than duplicating it into each one) is what makes a sample identifiable at all; without the unwrap the consistency column would have stayed empty while looking correctly implemented.

The grading and verify layers are read through the datasets face with an EXPLICIT single-layer scope (`layers: ['grading']` / `['verify']`) — narrower than the operator bypass the architecture table permits, and the narrowest thing that can reach an answer key at all.

## Alternatives considered

**Judge halted cells too, or judge only cells that reached `judged`.** Implemented as the former: the phase runs for any cell whose stage loop completed, `halted` included. A `feasible: false` cell is a real outcome with real material, and rubrics grade that judgement explicitly (F2's B1-1 is "feasible = true — the item is known implementable, so false is a wrong conclusion"). Restricting to `judged` would have made the one branch the rubric most wants to catch permanently unjudgeable, and would leave halted cells unable to pass the archive gate.

**Add a self-report regex (`I am <Capitalized>`) for the "I am Codex" class the brief names.** Rejected as redundant and harmful: the self-reported name IS a harness alias, so the alias rule already catches it, while a general capitalized-word rule would rewrite ordinary first-person prose in a design document and silently damage the material the judge is asked to read. The alias list is data and extends without code.

**Let the judge's `by` and `task` stand as written.** Rejected: they are coordinates, not judgements. A judge writing `by: "fake-judge"` (as an early test did) or echoing the placeholder from the prompt example would silently mis-attribute a verdict, and the report has no way to notice.

**Name the archive files `llm-draft-<sample>.json` as the brief spelled it.** Widened to `llm-draft-<judge condition>-<sample>.json`: the brief's form collides the moment a plan names two judge conditions, which `plan.judge.conditions` is plural precisely to allow. The annotation still carries the per-condition `sample` number the brief specified.

**Refuse the run when an item ships no rubric or no `llm-draft` rows.** Rejected: absence is data. The cell records `{kind: 'judge-skipped', reason}` and archives with fewer verdicts, exactly as an item with no probes writes no `script.json` — a run that produces partial verdicts honestly is more useful than one that refuses to start, and `expectedNs` already makes the report say what is missing.

## Consequences

`--finalize` now reaches `released` for real, and either source is sufficient — a dataset with probes and no judge finalizes, so does a judged dataset with no probes, and with neither the refusal is still recorded rather than bypassed. The report's judge-consistency column has samples to count.

The costs are real. Probes run as host processes (`node` / `/bin/sh`) with a five-minute cap and the cell directory readable to them; until I3 puts them behind `lab.verify` in a container, a hostile probe in a dataset is a hostile program on the host — datasets are reviewed in git, which is the mitigation, not a sandbox. De-fingerprinting is lexical and therefore both incomplete (a harness identifiable by its writing style stays identifiable) and occasionally over-eager (a design document legitimately discussing "the claude-code integration" gets rewritten); the recorded table is what makes either failure visible instead of silent. And judging inside the cell loop means a slow judge extends the cell's wall-clock, though not its active-minute budget, which stays the contestant's.

## Related

- [eval orchestrator run v0](2026-09-05-eval-orchestrator-run-v0.md) — the loop this phase plugs into; its orchestrator-ns records are what the judge extends.
- [eval report verb](2026-09-05-eval-report-verb.md) — the consumer: the sample envelope exists so its judge-consistency column can count samples.
