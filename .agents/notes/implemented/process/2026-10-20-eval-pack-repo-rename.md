# Agent Note: The eval pack's repo-layer rename (dsh-web-eval → dsh-eval)

Status: implemented

## Problem

The evaluation pack's mirror repo was `Khorsheed/dsh-web-eval`, while the user decided the public name shortens to `Khorsheed/dsh-eval` (the GitHub-side rename is the user's; the old URL redirects). `scripts/sync-mirror.mts` derives the mirror repo name from the monorepo directory, so the rename had a repo-internal half: `profiles/web-eval` → `profiles/eval`, plus every living reference. The hazard was over-renaming: the pack's RUNTIME identity — the installed profile at `$DSH_HOME/profiles/web-eval`, `dsh --profile web-eval`, the profile manifest's `name`, and the npm packages (`@khorsheed/dsh-eval-suite`, `@khorsheed/dsh-web-eval-preset`) — is load-bearing for every installed instance and was explicitly out of scope.

## Decision

Rename only the repo/directory layer; keep the runtime layer byte-identical.

- **Moved**: `profiles/web-eval` → `profiles/eval` (plain `mv`); the mirror becomes `dsh-eval` on the next `sync:profile eval`. The pack's display name follows the repo: README H1s (`# dsh-eval`), script banner comments and the `dsh-eval:` log prefixes (the basic/dev convention ties both to the repo name), clone instructions, and `scripts/web-eval-preset-bundle.spec.ts` → `scripts/eval-preset-bundle.spec.ts`. Every `profiles/web-eval/…` monorepo path in living files — specs, checkers, README links, `docs/`, package comments — now reads `profiles/eval/…`; `docs/packages.md` is regenerated (`pnpm map:packages`).
- **Kept**: the runtime profile (`dsh-profile-web-eval`, `--profile web-eval`, `$DSH_HOME/profiles/web-eval`, `restart-into-web-eval.sh`, install/update `DEST`), all npm names, CHANGELOG history, dated documents (iterations.md, the t-task logs, handoff narratives), and bare `web-eval` where it names the runtime instance ("the web-eval instance", "web-eval frozen decision N"). Agent Notes kept their prose; only link targets pointing into this repo moved to `profiles/eval/…`, with sidecars re-recorded.
- The preset bundle's sha256 pin (`scripts/eval-preset-bundle.spec.ts`) moved on a comment-only edit: one provenance comment inside the hashed `plugins:` block carried the old path. The digest update and its reason are recorded in that spec's comment history; the composition is unchanged.

## Alternatives considered

- **Rename the runtime layer too** (`profiles/eval` under `$DSH_HOME`, `--profile eval`). Rejected by the user: it would orphan every installed instance's home for zero functional gain; the runtime name is user-facing state, not repo structure.
- **Rename the npm packages to match.** Rejected by the user: package names are published identity; `@khorsheed/dsh-eval` the orchestrator already holds the short name, and `@khorsheed/dsh-web-eval-preset` is a private, profile-local bundle that never ships.
- **Sweep bare `web-eval` prose everywhere.** Rejected: most remaining occurrences name the runtime profile/instance, which still exists under that name; rewriting dated records falsifies them.

## Consequences

- `git grep` for `dsh-web-eval` now lands only on the npm preset name, CHANGELOG history, dated notes/docs, and scratch logs; `profiles/web-eval` lands only on runtime (`$DSH_HOME`) paths and history.
- Worktrees branched before the rename still carry `profiles/web-eval/` (16 in flight on 2026-10-20): their merges need a path-aware rebase onto the renamed tree — trivial for content, but a pure rename collision if a branch adds files under the old path.
- Two dated notes cite the old spec filename `scripts/web-eval-preset-bundle.spec.ts` in prose; they stay as written — the spec lives at `scripts/eval-preset-bundle.spec.ts` now.
