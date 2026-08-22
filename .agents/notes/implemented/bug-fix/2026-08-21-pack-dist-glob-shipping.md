# Agent Note: pack-dist expands files globs — packaged skills actually ship

Status: implemented

English | [中文](2026-08-21-pack-dist-glob-shipping.zh.md)

## Problem

`filesDeclaredExtras` in `scripts/pack-dist.ts` explicitly **skipped every glob entry** in a package's `files` field, under the stale comment "no package currently files anything else globbed". file-preview's `skills/**/*.md` (the 3d-artifact skill) — and ankh-guard's same-shaped restart-guard skill — are exactly that: globs. `pnpm pack` honors them, so the pack-smoke tests passed, but the deploy path (`deploy:3080` → `scripts/pack-dist.ts`) staged only literal extras + `lib/`, and the tarball it published dropped the skill files. The prod 3080 profile after the first M1/M2 deploy had the skill's registration code but no `skills/3d-artifact/SKILL.md` — the registration degraded to a warning and the skill never entered the catalog.

## Decision

`filesDeclaredExtras(files, packageDir?)` now expands `dir` double-star globs against the package dir when one is given — recursive suffix match (`<dir>/**/*.ext`) and every-file (`<dir>/**/*`), the two shapes in use — while literal extras behave as before and globs are still skipped when no dir is supplied (pure-function semantics preserved; spec updated). The copy loop already created parent dirs, so expanded files stage correctly.

## Alternatives considered

- **Switch pack-dist to `pnpm pack`**: rejected — pack-dist exists to rescope the manifest and rewrite self/family names in payloads; `pnpm pack` would run `prepare` and ship the wrong names.
- **Enumerate each skill file literally in `files`**: rejected — the glob is the package convention; enumeration breaks as skills are added and diverges from what `pnpm pack` honors.

## Consequences

- The 3d-artifact skill ships in the tarball and registers in prod (verified: `skills/3d-artifact/SKILL.md` present in the 3080 profile after the redeploy; the running instance's skill catalog lists it; no boot warning). ankh-guard's restart-guard skill had the same latent gap and is fixed by the same change.
- Anyone packaging skill/script globs through pack-dist gets them now; the stale "nothing else globbed" comment is gone.
- Migration parties packaging dsh plugins should re-verify their tarballs (`tar -tzf`) for glob-declared payloads.
