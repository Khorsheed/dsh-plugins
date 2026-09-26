# Agent Note: AGENTS.md ghost commands — `build:lib:host` and `dsh preflight` named things that don't exist here

Status: implemented

English | [中文](2026-09-27-agents-md-ghost-commands.zh.md)

## Problem

The owner reported that AGENTS.md's build contract tells agents to open a clean worktree with `pnpm install && pnpm run build:lib:host`, a script this repo does not define — the name exists only upstream (`deepseek-harness/package.json`: `build:lib:host = tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`), copied over and never adapted. The line sits at the top of the build contract, so a clean-worktree agent tripped on the very first command it was told to run.

A same-day full audit of every command/path AGENTS.md references (the owner then asked for exactly that sweep) found one more ghost and two stale facts:

- **Ops**: "Restarts are gated by `dsh preflight --profile web`" — the `dsh` CLI has no `preflight` subcommand (zero hits in `apps/cli/src`, absent from `--help`). The real gate is the ankh-guard CLI's `preflight` verb (`bin: dsh-ankh-guard → lib/cli.js`), which `deploy:3080` runs automatically as gate ⑤.
- **Build contract**: "the other nine invocations in a repo build hit the stamp" — the typert package count had drifted to fifteen.
- **Repo hygiene**: the screenshot rule covered doc pages (`docs/screenshots/`) but not package README images, which npm renders from the dsh-web-basic mirror and which the mirror sync deletes unless they are tracked under `profiles/web-basic/docs/screenshots/` (see [README screenshot hosting](2026-09-27-readme-screenshot-hosting.md)).

Everything else referenced — all `check:*`/`test:*`/`deploy:3080`/`hooks:install` scripts, `scripts/gen-typert.mts` (incl. `GEN_TYPERT_FORCE`/`GEN_TYPERT_ONLY` and the `$DSH_HOME/scratch/typert-cache.json` path), `build/tsdown.client.ts`'s `clientBundle`, `build/vitest.ts`, `.githooks/pre-commit`, `docs/{development,ops,publishing,plugin-visibility,upstream-seam-registry}.md`, and ops.md's 构建卫生 section — verified present and accurate.

## Decision

Four in-place AGENTS.md edits, shipped the same day (the owner designated the session the docs owner and told it to land the fix):

1. Clean-worktree first command: `pnpm install && pnpm run build` — the recursive workspace build runs in dependency order, so each package's `gen-typert → tsc → tsdown` lands host artifacts before any dependent's client tsc; the ordering guarantee the sentence exists for is preserved.
2. Restart gate: named as ankh-guard's composition preflight run by `deploy:3080`, with the standalone form given as the ankh-guard CLI's `preflight` verb and an explicit "no `dsh preflight` subcommand exists" warning.
3. "the other nine invocations" → "every later invocation", so the sentence stops rotting as typert packages are added.
4. Screenshot rule gains the README branch: package README images are tracked in `profiles/web-basic/docs/screenshots/` (`git add -f`), because the mirror sync wipes anything else in the mirror.

## Alternatives considered

**Hand the fix to a docs owner via a proposed note.** Tried first (the note started in `proposed/` per the owner's handoff request); the owner then designated this session as the docs owner and ordered the fix landed, so the note moved here with the change.

**Point the clean-worktree command at `tsx scripts/gen-typert.mts` alone.** Rejected as the default: it is cheaper but proves nothing about any package's tsc/tsdown chain, which a clean worktree has never run; the full `pnpm run build` is the honest first proof and is the same script the pre-commit gate already requires.

## Consequences

Every command AGENTS.md names now exists in this repo; the two ghost commands can no longer burn a clean-worktree agent's first step or send anyone hunting for a nonexistent `dsh` verb. The note's audit list above doubles as the checklist for the next documentation sweep.

## Testing

Doc-only change. Verification was mechanical: root `package.json` scripts enumerated; the harness CLI's `apps/cli/src` and `--help` output grepped for `preflight`; every referenced path checked with `test -e`; typert package count via `grep -l '"./typert"' packages/*/package.json`. `verify-agent-note-format`/`verify-agent-note-classification` and the pairing checker pass on the moved note.

## Related

- [README screenshot hosting lives in profiles/web-basic](2026-09-27-readme-screenshot-hosting.md) — the mirror-sync mechanics behind edit 4.
- [ankh-guard self-deploy reconfigure](2026-09-26-ankh-guard-self-deploy-reconfigure.md) — the runbook where the real preflight invocation lives.
