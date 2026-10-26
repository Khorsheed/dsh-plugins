# Agent Note: Each suite mirror has one source — packages/<suite>

Status: implemented

## Problem

The dsh-basic and dsh-dev mirror repos had two candidate sources in this repo. `profiles/basic` and `profiles/dev` were the old clone-and-run "profile packs": a `package.json` pinning every member, `scripts/install.sh` / `update.sh` / `restart-into-*.sh`, a second README pair, and (dev) a directory preset under `presets/`. They were synced with `sync:profile` (kind `profile`). Meanwhile `packages/basic` and `packages/dev-suite` became the real install units — users paste the npm name into DSH, and the mode preset lives in the suite's own `cordis.patch.yml` — and the learning, video and gamedev mirrors already synced from `packages/<suite>` (kind `package`). The two README pairs drifted (the dev profile README still showed old screenshots and an install.sh section for hosts before 0.1.7), and the profile membership was out of date (it still listed ankh-guard under basic).

## Decision

`packages/<suite>` is the only source of its mirror (`Khorsheed/dsh-<short name>` through `MIRROR_REPO_NAMES`). `profiles/basic` and `profiles/dev` are deleted.

- **Screenshots** moved to `packages/basic/docs/screenshots/` with `git mv` (still force-tracked). The dsh-basic mirror, synced from `packages/basic`, keeps them at `docs/screenshots/`, so every README's raw URL is unchanged. `docs/` is outside the package's `files`, so the npm tarball does not carry them. The dev profile's screenshots were byte copies of the basic set, or unreferenced; they were dropped. The dev-suite README already embeds dsh-basic URLs.
- **READMEs**: the package READMEs were already the newer front pages. The profile copies only added the install.sh path for old hosts, which is retired. `LICENSE` was copied into both suite packages so the mirrors keep one.
- **Tooling**: `scripts/sync-profile-mirror.mts` and `sync:profile` are retired. `pnpm sync:mirror <kind> <name>` is the single entry, and CI's mirror check runs `sync:mirror package basic --check`. The `profile` kind stays in `sync-mirror.mts` for `profiles/eval`, the held-back eval line with its own mirror. `release-status` reads basic membership from `packages/basic/package.json`. `check-install-spec-floors` scans every package README plus the remaining profiles.

## Alternatives considered

**Keep the profiles as thin mirror sources.** Rejected: two READMEs per suite drift, and a cloned install path nobody should use stays public.

**Move eval to `packages/` too.** Out of scope: `profiles/eval` is pinned by `scripts/eval-preset-parity.spec.ts` and its own install flow.

## Consequences

- The first push-mode sync after this lands rewrites both mirrors: install scripts, `pnpm-workspace.yaml` and (dev) `presets/` disappear; `src/`, `tests/`, `locale/` and build config appear. dsh-dev also loses the ten screenshots it carried; nothing in this repo links to them.
- CI's mirror check fails until that sync is pushed. That is the intended signal.
- A new README screenshot goes into `packages/basic/docs/screenshots/` (`git add -f`).

## Testing

`sync-mirror.mts package basic --dry-run` / `package dev-suite --dry-run` show the rewrite above, with no screenshot change for dsh-basic. `npm pack --dry-run` in `packages/basic` lists no `docs/`. `pnpm test:scripts`, `check:plugins`, `check:collections`, `check:packages`, `check-install-spec-floors`, translation pairing and hygiene.

## Related

- [README screenshot hosting](2026-09-27-readme-screenshot-hosting.md) — the tracked-image rule this keeps; only its path moved.
- [Package directories match their npm names](2026-10-26-package-dirs-match-npm-names.md) — where `MIRROR_REPO_NAMES` came from.
