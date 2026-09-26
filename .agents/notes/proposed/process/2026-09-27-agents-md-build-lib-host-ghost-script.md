# Agent Note: AGENTS.md's clean-worktree first command names a script that only exists upstream

Status: proposed

English | [中文](2026-09-27-agents-md-build-lib-host-ghost-script.zh.md)

## Problem

AGENTS.md § Build contract tells every agent: "In a clean worktree the first command is therefore always `pnpm install && pnpm run build:lib:host`". This repo has no such script — the root `package.json` script set is `build`, `test`, `test:scripts`, `typecheck`, `check:*`, `deploy:3080`, etc., and no `packages/*/package.json` defines it either. Following the instruction fails with pnpm's "Missing script" error, and because the sentence sits at the top of the build contract, a clean-worktree agent trips on the very first command it is told to run.

The name exists only **upstream**: `deepseek-harness/package.json` defines `build:lib:host = tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host` (paired with `build:lib:client`). The line was copied from the harness's build docs and never adapted to this repo's script names. Verified 2026-09-27: root scripts enumerated, `build:lib:host` greps clean across `packages/*/package.json`, `scripts/`, and `docs/`; the only occurrence is AGENTS.md:20 itself.

## Proposal

One-line fix in AGENTS.md § Build contract: replace `pnpm install && pnpm run build:lib:host` with `pnpm install && pnpm run build`. The root `build` is `pnpm -r --workspace-concurrency=2 --if-present run build`, and pnpm runs workspace packages in dependency order, so each package's own `gen-typert → tsc → tsdown` chain lands host artifacts before any dependent's client tsc — exactly the ordering guarantee the sentence exists to make. If the intent was a cheaper first step than a full recursive build, name it explicitly instead: `tsx scripts/gen-typert.mts` (optionally `GEN_TYPERT_ONLY=<pkg>` as deploy:3080 does), then `pnpm run build`.

Filed for the docs owner per the user's request (2026-09-27: "这条请转给维护文档的人修") — deliberately not fixed in place by the reporting session.

## Alternatives considered

**Fix in place immediately.** Set aside per the user's explicit handoff request — the change is deliberately parked here so the docs owner lands it.

**Point at `tsx scripts/gen-typert.mts` as the first command.** Covered as the lighter variant in Proposal; a full `pnpm run build` is the safer default because it also proves every package's tsc/tsdown chain, which a clean worktree has never run.

## Acceptance criteria

AGENTS.md § Build contract names only commands that exist in this repo's root `package.json`; an agent in a clean worktree can run the stated first command without a missing-script error.

## Risks

None — doc-only change. The only residual risk is the line rotting again if the root script set is renamed; the fix names `build`, the same script the pre-commit gate already tells every agent to run.

## Related

- The harness-side script the line was copied from: `deepseek-harness/package.json` → `build:lib` / `build:lib:host` / `build:lib:client`.
