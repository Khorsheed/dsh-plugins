# Agent Note: gen-typert freshness cache — one generation per build, not one per package

Status: implemented

## Problem

Every package build script runs `tsx ../../scripts/gen-typert.mts`, and a full-mode run regenerates ALL ten registered typert packages' outputs in one ~45–50s overlay+analysis batch. A full-repo build therefore paid the batch cost ten times over (~450s of work), which measured out to roughly two-thirds of the cold full-repo build (5m47s wall at workspace-concurrency 2 on the 16GB/8-core machine). CI pays this on every run, and every agent's local full build paid it even when nothing the generator reads had changed.

## Decision

Full-mode runs consult a freshness stamp at `$DSH_HOME/scratch/typert-cache.json` before building an overlay:

- The cache key covers everything a batch reads: this script's own contents, every selected package's `package.json` + host tsconfigs + `src/` tree (exactly what `copyTypertPackageSources` overlays), and the harness checkout's git state (`HEAD` + `status --porcelain` — an uncommitted harness change is a miss). Any input change misses and regenerates.
- The stamp also records the sha256 of every output file it produced; a deleted or rewritten output (cold `lib/`, hand-edited artifact) is a miss.
- `GEN_TYPERT_FORCE=1` forces regeneration. Scoped `GEN_TYPERT_ONLY` runs (the deploy path) never read or write the stamp: a deploy always generates against live sources, and scoped output (siblings resolved from built `lib/types`) differs from full-mode output and must not poison it.
- Concurrent invocations (workspace-concurrency 2) serialize on a `typert-gen.lock` mkdir; the loser re-checks the stamp and normally finds it fresh. A crashed generator's stale lock is broken after a 15-minute wait — the worst case then is a duplicate generation with identical outputs.

Effect, measured on the 16GB machine: cold full-repo build (no stamp, all `lib/` deleted) 5m47s → 1m08s (one generation batch + nine stamp hits); warm build 12s; a single cached invocation answers in ~0.8s. Correctness invariant: a cache hit requires byte-identical inputs AND byte-identical outputs on disk, so a hit can only occur when regeneration would produce the same files.

## Alternatives considered

- **Scoping every package's build to `GEN_TYPERT_ONLY=<self>`** — removes the 10× duplication in structure, but each scoped run still builds an overlay and analyzes (tens of seconds × 10 packages), and scoped generation resolves siblings from built `lib/types`, so a cold build would newly depend on every referenced sibling's lib already existing — an ordering constraint the manifest graph does not fully express (type-only references). The cache keeps full mode's robustness and makes repetition free instead of merely smaller.
- **Caching on repo HEAD alone** — too coarse: a dirty working tree (the normal multi-agent state) must regenerate, and file-level input hashing costs under a second, so the precise key was cheap to have.
- **Letting the deploy path use the cache** — deploys exist to prove current sources build green; a deploy that skips generation weakens the credential the watchdog binds to git HEAD. Scoped runs stay uncached.

## Consequences

- Cold full-repo builds are ~5× faster; the remaining long pole is `tsc -b` + tsdown across 32 packages. CI gains the same without any runner state: the first typert package's batch makes the other nine invocations hit the stamp within the same run.
- The stamp lives outside the repo (`$DSH_HOME/scratch`), so nothing about `git clean`, worktrees, or packed tarballs changes; a stale stamp can only cause a regeneration, never wrong output (outputs are hash-verified on every check).
- Given up: nothing behavioral; `GEN_TYPERT_FORCE=1` recovers the old always-generate semantics for debugging the generator itself.

## Testing

- `scripts/gen-typert.spec.ts` gains a cache suite: input hash moves on src edits and is stable otherwise; the stamp accepts intact key+outputs and rejects key drift, rewritten outputs, deleted outputs, and a missing stamp; a non-git harness checkout is "uncacheable", not a crash.
- Live: first full run writes the stamp (~49s), the second answers in 0.8s; a cold-lib full build with the stamp deleted finishes green in 1m08s with exactly one generation batch and nine lock hits; `pnpm run test:scripts` green.
