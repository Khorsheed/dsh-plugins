# Agent Note: 每 agent 一个 worktree，主 checkout 只收绿 main

Status: proposed

English | [中文](2026-08-18-per-agent-worktree-isolation.zh.md)

## Problem

The repo checkout doubles as the prod-linked checkout, so two agents sharing
one checkout cannot test and deploy independently:

1. The production profile (`$DSH_HOME/profiles/web/package.json`, port 3080)
   `link:`s every package into the repo checkout; a watchdog restart serves
   whatever `lib/` that checkout currently holds, regardless of whose in-flight
   work produced it.
2. A shared workspace means A's `pnpm run build` / `pnpm run test` compiles
   B's half-finished source, B's lockfile churn can trigger a profile
   `pnpm install` and a watchdog restart mid-A, and a restart serves B's
   intermediate or stale `lib/` — so A's deploy verification fails for reasons
   entirely outside A's control.
3. Observed repo state on 2026-08-18: the main checkout held uncommitted
   `context-guard` source changes while `lib/` was stale (built 00:24, source
   edited 00:58–01:03) and a new uncommitted `SettingsCard.tsx` was not in
   `lib/` at all; any restart would have served that in-flight state and
   blocked another agent's deploy verification. The guide's existing
   mitigations are social — "coordinate restarts in the open", "keep `main`
   green", "never leave a stale or missing `lib/`" — and none of them survives
   the pre-commit window where B is mid-edit.

The harness-side deployment guide already assumes worktrees (its build-order
contract: the first command in a worktree is always `pnpm install && pnpm run
build:lib:host`), and this repo already uses one in practice
(`dsh-plugins-wt-local-agent-dsh`), but the repo AGENTS.md neither mandates nor
documents the rule — that gap is what this note closes.

## Proposal

Make isolation a written rule in AGENTS.md ("Multi-agent concurrency" section):

- **One worktree per agent; the main checkout is deploy-only.** Every agent
  does editing, building, and testing in its own worktree
  (`git worktree add ../dsh-plugins-wt-<topic> -b <branch>`); nobody edits
  source in the main checkout. The main checkout only ever receives green
  `main` (pull/merge), and its `lib/` is rebuilt only from merged green `main`,
  so the prod `link:`s always resolve to a deployable state.
- **Fresh-worktree bootstrap contract** (aligns with the harness guide): the
  first command is `pnpm install && pnpm run build:lib:host` — host face before
  client face, because the client tsc consumes generated `./typert`/`./remote`
  artifacts and fails misleadingly otherwise.
- **Verification split**: pre-merge runtime verification happens against a
  scratch test profile (tarball or a link to the worktree), never by writing
  in-flight work into the main checkout's `lib/` or re-pointing the prod
  profile; the live instance at :3080 verifies merged green `main` only.
- The rules this replaces stay where they remain true: never develop in
  `/tmp`/`scratch/` throwaways, keep `main` green before every commit, package
  ownership, coordinate restarts in the open.

The exact ready-to-apply AGENTS.md diff is in the
[appendix](#appendix-agentsmd-diff) below.

## Alternatives considered

### Why not keep the shared checkout and rely on the social rules?

That is the status quo that produced the incident. "Coordinate restarts in the
open" and "never leave stale `lib/`" govern the moments between commits; the
failure window is exactly the uncommitted in-between state, which no social
rule can make safe. Rejected because it is the current mechanism of failure.

### Why not per-package ownership locks without worktrees?

Package ownership (check `git log` before reworking a package) prevents one
agent silently overwriting another's direction, but it does nothing about the
shared build and the shared prod-linked `lib/`: two agents on different
packages still compile each other's in-flight source and still share one
restart-served `lib/`. It solves a different problem and is kept alongside,
not instead.

### Why not only a scratch test profile, no worktree?

The scratch profile fixes pre-merge runtime verification, but A's
`pnpm run build` / `pnpm run test` still runs in the shared workspace and still
compiles B's in-flight source; build pollution and lockfile/restart churn
remain. It is a necessary complement (verification must not touch prod), not a
substitute for isolation.

### Why not re-point the prod profile at the worktree during development?

Re-pointing shared prod state is exactly the coordinated mutation churn the
rule eliminates, and it recreates the same hazard under a new name. The prod
profile stays pinned to the main checkout; live-instance verification is a
merged-`main` activity.

## Acceptance criteria

- AGENTS.md's "Multi-agent concurrency" section states one-worktree-per-agent
  and main-checkout-deploy-only, with the bootstrap contract, per the appendix
  diff.
- The main checkout's working tree carries no in-flight feature work at any
  time — only merge commits and post-merge `lib/` rebuilds; a fresh worktree
  bootstraps with `pnpm install && pnpm run build:lib:host` and builds/tests
  green without touching the main checkout.
- A restart of :3080 serves merged-green-`main` `lib/` only; the stale/in-flight
  failure mode (A blocked by B's uncommitted state) no longer occurs.

## Risks

- One extra checkout per agent: disk and a per-worktree `pnpm install`
  (node_modules are not shared across worktrees). Already the de-facto norm for
  this repo; accepted.
- Worktrees share one `.git`; branch-per-worktree discipline is required, and
  merge coordination still follows the existing pull-before / push-when-finished
  rules — the rule adds isolation, not branch hygiene.
- The main checkout's `lib/` must be rebuilt after every merge before a
  restart; the old "never leave a stale or missing `lib/`" rule narrows to the
  post-merge window, which is smaller than today.

## Appendix: AGENTS.md diff

Replace the "Never develop in `/tmp`..." bullet and the "Prod links here."
bullet in the "Multi-agent concurrency" section with the following (the "…"
line marks the unchanged bullets between them):

```markdown
- **One worktree per agent; the main checkout is deploy-only.** Add `git worktree add ../dsh-plugins-wt-<topic> -b <branch>` and do all editing, building, and testing there — never edit source in the main checkout. The main checkout only ever receives green `main` (pull/merge), and its `lib/` is rebuilt only from merged green `main`, so a restart always serves a deployable state. First command in a fresh worktree: `pnpm install && pnpm run build:lib:host` (host face before client face — build contract below). Pre-merge runtime verification happens against a scratch test profile (tarball or worktree link), never by writing in-flight work into the main checkout's `lib/` or re-pointing the prod profile.
- **Never develop in `/tmp`, `scratch/`, or any throwaway directory.** A message-tools production line (0.2→0.4.7) was lost this way. A worktree of this repo (or a sibling path next to it) or nowhere.
- **Keep `main` green.** Before every commit: `pnpm run build && pnpm run test` for the packages you touched. Commit each logical change separately as soon as it is green.
…
- **Prod links the main checkout.** The production profile (`$DSH_HOME/profiles/web/package.json`, port 3080) `link:`s these packages at the main-checkout path. `pnpm install` in the profile can trigger a watchdog restart, and a restart serves whatever `lib/` the main checkout currently contains — under the worktree rule, always merged green `main`. Rebuild `lib/` after every merge; coordinate restarts in the open.
```
