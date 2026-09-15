# Agent Note: Freeze admitted model and effort for evaluation members

Status: implemented

## Problem

Evaluation conditions already hash effort, but delegation had no effort channel. Allowing interactive member controls without a frozen admission contract could change a condition between rounds while its hash stayed unchanged. Requested settings also cannot serve as evidence of what a native harness used.

## Decision

Evaluation players, readiness probes, container runs and judges pass explicit native effort through the shared delegation options and attach a condition lock. Legacy `default` conditions keep their bytes and hashes. The member controller persists its first admitted default model and effort and pins subsequent rounds and restart reconciliation to that snapshot. Interactive selection cannot change a locked member.

The registry records configuration evidence against the exact returned run object. Evaluation records declared, requested, admitted and natively observed effort separately; missing observations stay unverified. Explicit effort requires a provider configuration adapter before any paid prompt. Mismatches exclude verdicts from comparisons while retaining cost and evidence. Report import recomputes evidence status instead of trusting a stored verdict.

## Alternatives considered

**Rewrite existing condition baselines.** Changing legacy default conditions would invalidate frozen comparison hashes without proving native behavior. Existing documents remain unchanged; a golden hash test pins that contract.

**Treat requested effort as observed.** A command-line option or accepted configuration is admission evidence, not proof of the generation. Unknown native observations remain visible and prevent verified comparison claims.

**Read only the member's latest configuration.** A following turn can change current state before an earlier result is annotated. Evidence is bound to the exact run and copied on read.

## Consequences

Default changes no longer silently alter a locked evaluation member across rounds or restart. Unsupported explicit effort fails before paid execution. Historical reports without new evidence retain their existing interpretation. New runs whose native harness does not report effort remain unverified; this can block comparative rankings until native evidence is available.

## Testing

Core tests cover frozen defaults across subsequent turns and restart, run identity, and durable controls. Evaluation tests cover player/judge/readiness/container forwarding, immutable resume options, unsupported-provider refusal, forged imported evidence, and the unchanged legacy condition hash. Scoped core and evaluation builds pass; their full suites pass 306 and 619 tests respectively.
