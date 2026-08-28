# Agent Note: lab — acceptance fixes: flag validation, manifest tolerance, activity baseline

Status: implemented

English | [中文](2026-08-24-lab-acceptance-fixes.zh.md)

## Problem

Three defects caught in live acceptance against the evaluation orchestration, each with a reproduction:

1. **An unknown CLI flag carrying a value exited 0 silently.** `--manifest-path <value>` (for `--manifest`) was consumed by the generic parser, the manifest was never written, the artifact never registered, and nothing said so — discovered only when the view showed nothing. Misspelled flags are the highest-frequency accident in orchestration scripts.
2. **The status view's materialization read took the FIRST artifact and crashed on ghosts.** Mission indexes append-only; a stale record whose file no longer exists made the join throw ENOENT and blanked the whole TASK column. (mission now fails loud at registration for missing paths — `f4dbb62` — but existing ghost records persist.)
3. **`lastActivityAt` read fake-idle on fresh units.** `docker cp` preserves source mtimes, so a just-populated unit displayed "3d12h ago" — the stuck-cell detector reading garbage exactly where it must be trusted.

## Decision

1. **Per-verb flag whitelist.** `VERB_FLAGS` declares each verb's value-flags and boolean flags; `validateFlags` runs after parsing and rejects anything unknown with exit 2 — with or without a value. A value-less trailing `--flag` is classified at validation (known value-flag → "missing value", otherwise → "unknown flag"), replacing the parser's old generic "missing value" error.
2. **Newest-first, skip-with-warning.** The status join iterates `materialization` artifacts in reverse registration order, reads each manifest file, and takes the first readable one with a `sha`; unreadable or shapeless records are skipped with a warning per record — one ghost can no longer blank the column.
3. **Populate stamps the baseline.** After `docker cp`, the provider touches `<target>/.lab-materialized`; the marker file's mtime IS the populate moment, so the mtime probe's baseline is "materialized now" instead of "source files' age". The marker also lands in later archives as the populate timestamp. (Rejected alternative: an in-memory `populatedAt` — it dies with the host process and labels can't be added to a created container.)

Also adapted to mission's tightened artifact contract (`f4dbb62`: registration fails loud unless the path is relative to the attempt's run-data directory and exists): `populate` / `collect` / `archive` gained `artifactPath` (CLI `--artifact-path`), the path registered with mission, defaulting to the previous behavior. The triad driver now collects into the attempt's run-data directory and registers relative paths. Registration remains warn-and-skip on the lab side — but a registration warning now more likely means a real path error than a ghost, per the feedback.

## Alternatives considered

- **Parser-level rejection of unknown flags without values** — insufficient alone: the parser cannot know a flag is unknown when it consumes the next token as its value; only a post-parse whitelist catches both shapes.
- **Mission-side ghost cleanup** — rejected as lab's fix: mission's append-only index is deliberate; the reader (lab) tolerates.
- **In-memory `populatedAt` or a container label** — rejected: the first dies at restart, the second is impossible post-creation; the marker file survives both and self-documents.

## Consequences

- 64 package tests + 16 integration assertions green; new cases pin: unknown flag with value → exit 2 naming the flag, value-less unknown → exit 2, newest-first manifest read, ghost skip with warning + fallback, populate's marker touch in the argv contract.
- `artifactPath` is additive; existing callers (no flag) behave as before unless their target was an absolute path outside the run-data directory — those now hit mission's fail-loud, surfaced as a lab warning (the triad driver's old shape; fixed in the driver).
- The `.lab-materialized` dotfile appears in workspaces and later archives — intentional; documented in both READMEs.

## Testing

`tests/cli.spec.ts` adds the two flag-validation cases; `tests/service.spec.ts` adds the newest-first/ghost-tolerance pair; `tests/docker.spec.ts` asserts the marker touch after `docker cp`. Integration suite re-run green with the run-data-relative artifact paths.

## Cross-references

- [lab materialization/status note](../feature/2026-08-24-lab-materialization-status-view.md) — the features these fixes harden.
- [triad integration](2026-08-20-triad-integration-test.md).
