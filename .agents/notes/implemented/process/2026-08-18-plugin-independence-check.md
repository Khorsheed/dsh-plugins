# Agent Note: plugin independence check — the package conventions are mechanically enforced

Status: implemented

English | [中文](2026-08-18-plugin-independence-check.zh.md)

## Problem

The repo's package conventions (self-mounting, the identity triangle, no inter-plugin dependencies outside the two sanctioned pairs, degrade-don't-explode) are what make "every plugin installs, runs, and uninstalls alone" true — the property the bundle/整合包 distribution story depends on. Until now they were review-enforced only, and a 2026-08-18 audit of all 17 packages showed drift accumulates: taskpilot had hand-rolled its client bundle and diverged its invariant name, and the foreign-scope identity sweep found stale `@deepseek-ai/dsh-*` self-references in five packages' READMEs and patch comments. With several agents working the repo concurrently, conventions that live only in AGENTS.md prose erode silently.

## Decision

`scripts/check-plugin-independence.ts` (`pnpm check:plugins`) scans every package under `packages/` and fails on:

1. **Self-mounting** — a missing `dsh.bundle.patch`, a patch file that doesn't exist, or a patch not listed in `files` (family-internal row packages are exempt via `NO_OWN_PATCH`, currently only `local-agent-tool-subagent`).
2. **Identity** — unquoted `name:` values in `cordis.patch.yml`, no patch row matching the package name, `src/invariant.ts`'s PACKAGE_NAME diverging from the package name, and browser halves not built through the shared `clientBundle` helper (or built with a mismatched id).
3. **Foreign scope** — READMEs and patch files referencing one of this repo's own packages under `@deepseek-ai/` (the pre-consolidation identity).
4. **Cross-plugin edges** — source imports or package.json dependency edges onto `@khorsheed/*` outside `ALLOWED_EDGES` (the local-agent core/companion family and the ui-file-preview client/host pair); intra-repo specs must be exactly `workspace:*`.
5. **Inject discipline** — nothing injects a `@khorsheed/*` package, and community-provided services (`localAgent`, `localAgentDshHeadlessStartup`, `shortcuts`) may only be injected inside their owning family (`COMMUNITY_SERVICE_INJECTORS`); everyone else probes with `ctx.get` and degrades.
6. **Publish metadata** — non-private packages point `repository` at this monorepo with the right `directory` and carry `dsh-plugin` in `keywords`.

The check is whole-tree (cross-package edges and foreign-scope references cannot be evaluated per staged file), so it is not part of the pre-commit hook; instead its vitest spec re-runs `scanTree` against the real `packages/` tree, which makes `pnpm test:scripts` — already a pre-commit obligation per AGENTS.md — fail on any violation. The whitelists (`ALLOWED_EDGES`, `COMMUNITY_SERVICE_INJECTORS`, `NO_OWN_PATCH`) are the enforcement point: any new cross-package need is added there deliberately, in the commit that introduces it.

## Alternatives considered

- **Extend `check-repo-hygiene`** — rejected: the hygiene checker is a staged-set content scanner wired into the pre-commit hook; independence is a whole-tree structural audit. Merging them would either slow every commit or force staged-set approximations that miss cross-package edges.
- **Review-only enforcement** — rejected: the audit this follows found exactly the drift review missed.
- **CI-only gate** — rejected for now: the repo has no CI workflow yet; the spec hook into `test:scripts` gives the same failure signal locally, and a future CI can call `pnpm check:plugins` directly.

## Consequences

- Convention drift becomes a test failure instead of a postmortem finding; the sanctioned pairs remain possible but require an explicit whitelist edit, which is the review moment AGENTS.md asks for.
- The checker knows the current package inventory only structurally (it scans `packages/*`), so new packages are covered automatically; new *kinds* of exceptions require a whitelist edit plus a spec case.
- It does not attempt runtime co-install interference checks (slot-id or locale-namespace collisions) — those remain audit territory; the manifest-level conventions it does enforce are what make collisions unlikely.
