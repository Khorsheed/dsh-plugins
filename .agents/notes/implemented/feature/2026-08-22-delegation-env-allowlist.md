# Agent Note: delegation env allowlist — inherit deliberately, not by accident

Status: implemented

English | [中文](2026-08-22-delegation-env-allowlist.zh.md)

## Problem

Every delegation spawn passed only its scoped-home variable as the explicit `env`, so the child CLI inherited the whole scrubbed parent environment. That made every host-specific variable a latent per-harness incident: claude 2.1.236's credential resolution broke on the 3080 host because the ambient `USER` variable was inherited (bisected live: full env minus `USER` works, `USER` alone reintroduces 'OAuth session expired'). Fixing these one variable at a time, per harness, is a losing game.

## Decision

- New `delegationEnv(extra)` helper in the family core (`@khorsheed/dsh-local-agent`, `src/env.ts`): tombstones (`undefined`) every ambient key outside a platform allowlist and merges the caller's explicit entries on top. Used as a `SubprocessSpawnSpec.env`, the seam merges it over `scrubbedParentEnv()`, so allowlisted keys arrive by inheritance and everything else is removed. Verified tombstone semantics end to end: node spawn with `KEY: undefined` produces a genuinely unset variable in the child (not an empty string), and claude also tolerates the empty-string form — both spellings are safe.
- POSIX allowlist: `PATH HOME TMPDIR SHELL TERM`, locale (`LANG LC_*`), `XDG_*`, `SSH_AUTH_SOCK`, `NO_COLOR`, `GIT_TERMINAL_PROMPT`, and proxy variables in both casings. `USER`/`LOGNAME` are deliberately absent (the claude lesson; git resolves the author from `HOME`'s gitconfig). Windows: `PATH PATHEXT SYSTEMROOT SYSTEMDRIVE WINDIR COMSPEC TEMP TMP USERPROFILE HOMEDRIVE HOMEPATH APPDATA LOCALAPPDATA PROGRAMDATA` + proxies, matched case-insensitively.
- All eleven delegation spawn sites (kimi/codex/claude/dsh × exec fresh/resume + live driver) now wrap their explicit env in `delegationEnv`. Caller's explicit entries always win — credentials (`DEEPSEEK_API_KEY`), scoped home variables, and `ANTHROPIC_BASE_URL` overrides ride the explicit layer exactly as before. The claude provider's per-site `USER` tombstones are retired; the allowlist covers them.
- Anything a child genuinely needs beyond the allowlist must now be passed explicitly by the provider — that friction is the point: the delegation env is reviewed, not inherited by accident.

## Alternatives considered

- **Per-harness tombstones as incidents appear** — the status quo; each new host variable is a production P0 (the `USER` incident) before it becomes a tombstone.
- **Empty-string overrides instead of `undefined` tombstones** — works for claude but is not guaranteed to mean "absent" for arbitrary consumers; tombstones are the true removal and the seam already documents them.

## Consequences

- Login flows are intentionally NOT converged: the interactive `/<harness> login` spawns keep the ambient env (they open browsers and want the user's full context).
- The provider-internal option types (`start*CliRun` options, `memberEnv`) were widened from `Record<string, string>` to `Readonly<NodeJS.ProcessEnv>` so tombstones typecheck.
- Existing `toEqual` env assertions in provider tests keep passing because vitest ignores undefined-valued properties; new tests for the helper live in `packages/local-agent/tests/env.spec.ts`.
- First hidden dependency the allowlist surfaced (its design goal, caught in the 3080 smoke): the dsh subagent launches through the parent's tsx ESM hook, so `TSX_TSCONFIG_PATH` is a hard launch dependency — tombstoning it made the child die at import time ('FiberState' export mismatch) with a silent fast exit. The dsh provider (exec + live) now passes it explicitly when the parent has one.
