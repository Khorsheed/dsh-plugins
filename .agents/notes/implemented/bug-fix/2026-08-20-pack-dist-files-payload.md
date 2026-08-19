# Agent Note: pack-dist stages every files-declared payload, not just lib/

Status: implemented

English | [中文](2026-08-20-pack-dist-files-payload.zh.md)

## Problem

`scripts/pack-dist.ts` staged only the root documents (`STAGED_ROOT_FILES`) and `lib/` into the publish tarball. Anything else a package declares in its `files` field was silently dropped — for ankh-guard that is `scripts/dsh-watchdog.sh` plus the launchd/systemd installers, i.e. the entire supervision mechanism the package exists to ship. The first pack-dist-based ankh-guard publish (0.1.0-rc.7) came within one tarball inspection of releasing a guard with no watchdog. The previously published 0.1.0-rc.6.5 was packed from the standalone repo (it carries `LICENSE` and `README.en.md`, which the monorepo package does not have), which is why the gap went unnoticed.

## Decision

Staging now copies every plain (non-glob) path the manifest's `files` field declares, beyond the root docs and `lib/` already handled: `filesDeclaredExtras(pkg.files)` filters out glob entries (covered by the recursive `lib/` copy), `lib` itself, and the staged root files; each surviving path that exists in the package is copied into the staging tree preserving its relative location. `PackageJson` gained the optional `files` field.

## Alternatives considered

- **Hardcode `scripts/` as an extra staged directory** — names one package's layout, not the contract; the next package to ship `assets/` or `bin/` support files would silently lose them again.
- **Run `pnpm pack` in the package directory and rewrite the tarball after the fact** — the rescope must happen before packing (the manifest inside the tarball is what npm installs), and post-hoc tarball surgery is strictly more fragile than staging the declared files.
- **Fail when `files` names anything unstaged instead of copying it** — a loud error forces a manual list per package; copying the declared paths is the same safety with no per-package bookkeeping.

## Consequences

- Any package whose `files` lists plain paths now publishes them via pack-dist with no extra wiring; glob payloads outside `lib/` remain unsupported (none exist today — the filter skips them, and adding one later should extend `filesDeclaredExtras`, not bypass it).
- The ankh-guard 0.1.0-rc.7 tarball carries `scripts/dsh-watchdog.sh`, `scripts/install-launchd.sh`, and `scripts/install-systemd.sh`, verified by inspecting the packed archive before `npm publish`.
- Coverage: `scripts/pack-dist.spec.ts` pins the filter (plain paths kept; lib, root docs, and globs skipped), run via `pnpm test:scripts`.
