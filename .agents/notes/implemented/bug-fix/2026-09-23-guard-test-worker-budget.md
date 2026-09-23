# Agent Note: Honor the repository test worker budget in guard lanes

Status: implemented

## Problem

During mobile QR acceptance, process-heavy guard shards repeatedly exceeded their existing deadlines on a busy development machine. The repository worker budget affected Vitest but not the guard runner, which always started four independent shards.

## Decision

Read the existing DSH_TEST_MAX_WORKERS setting when scheduling lane tasks. Positive integers can reduce parallelism, capped at the original lane maximum; invalid values preserve the existing defaults. Every task, passing inventory requirement, assertion and timeout remains enabled.

## Alternatives considered

Skipping unrelated tests or increasing their deadlines would weaken the evidence. Stopping other users' applications is outside this task. A scheduling budget addresses avoidable contention without either action.

## Consequences

Busy machines can run all shards serially. Defaults and production runtime behavior are unchanged. Low concurrency takes longer when resources are plentiful and cannot guarantee success under arbitrary external load.

## Testing

The runner regression checks reduced budgets, upper caps and invalid values. The complete 212-test guard lane passes with DSH_TEST_MAX_WORKERS=1, retaining all shard inventory checks; the package build also passes.
