# Agent Note: npm trusted publishing — dispatch → CI stage → web approval, tokens leave the flow

Status: proposed

## Problem

Publishing currently runs from a maintainer laptop and every leg of it is fragile: TOTP enrollment is retired (2FA is security-key/WebAuthn only), recovery codes used as OTP trigger a 72-hour security hold (we ate one during the 0.1.5 wave), and granular access tokens are being squeezed — bypass-2FA tokens already cannot perform account/package-management actions, and direct publish with them ends 2027-01 (our publish token already gets EOTP). The 2026-09-17 wave shipped via manually-driven staged publishing (`npm login --auth-type=web` on the laptop, `npx npm@12 stage publish`, web approval) — workable, but the published artifacts are built on a local machine, the session-token swap in `~/.npmrc` is per-wave ceremony, and there is no CI-provable chain from a git commit to the staged artifact.

## Proposal

Move staging into CI with npm trusted publishing (OIDC) — no npm token anywhere:

1. `.github/workflows/publish.yml` (committed dispatch-only): inputs a package list; clones the harness seed at the ci.yml-pinned tag; builds + tests + packs the named packages from the workflow's commit; refuses versions that are already live; `npm stage publish` each tarball over OIDC (`permissions: id-token: write`, `environment: npm-publish`, npm@12 on node 24); the job summary lists what awaits approval.
2. npm side (one-time, per package, maintainer-only with the security key): package Settings → Trusted Publisher → GitHub Actions — org `Khorsheed`, repo `dsh-plugins`, workflow `publish.yml`, environment `npm-publish`, allowed actions **stage-only** (direct `npm publish` stays off: go-live always keeps a human approval).
3. Approval stays where it is: npmjs.com Staged Packages tab + security key. After approval, `npm view` confirms; `pnpm release:status` is re-recorded as today.
4. First live exercise: the next host-rc adaptation wave's publish.
5. `pack-dist` gains `--family auto` (derive companion edges from the manifest + workspace versions — the same derivation deploy-3080 already uses) so neither CI nor humans hand-enumerate family edges; publishing.md's pack step adopts it.

The GitHub Release / tag flow stays as-is (tags and releases are already created per wave); folding `gh release create` into the workflow is a follow-up if it proves tedious.

## Alternatives considered

- **Keep laptop staging (status quo)** — proven today, but artifacts are machine-local builds and the token/credential dance repeats every wave; it also has no answer for the 2027-01 bypass-token deadline.
- **OIDC with direct `npm publish` allowed** — one less human step, but removes the approval gate we explicitly want: every go-live keeps a maintainer + security-key confirmation. Stage-only is the deliberate choice.
- **Long-lived npm token in GitHub secrets** — the credential class npm is retiring; a leaked CI token is exactly the attack surface the new rules close.
- **Waiting for the 2027 forced migration** — staged publishing already works today (proven by the 2026-09-17 wave); the pipeline is cheap to build now and the next rc wave gives a natural rehearsal.

## Acceptance criteria

- A dispatch run of `publish.yml` stages a real package version entirely over OIDC (no `NPM_TOKEN` in CI), the package appears under Staged Packages, web approval publishes it, and `npm view` confirms the version.
- publishing.md describes the CI flow as the default, with the laptop staged path kept as the documented fallback.
- The npm-side trusted-publisher table covers every published package (10 as of 2026-09-17).

## Risks

- The npm-side config is per-package and manual (10+ web actions by the maintainer, one-time); a mismatch in org/repo/workflow filename/environment name fails the OIDC exchange loudly, never silently publishes.
- Brand-new packages cannot be staged (registry rule: the package must already exist) — a package's first release still uses the laptop path, then its trusted-publisher row is added.
- The workflow clones and builds the harness seed (the slow part of CI); acceptable for per-wave cadence.
