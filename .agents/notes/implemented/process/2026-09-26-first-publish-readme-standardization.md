# Agent Note: README standardization for the first-publish wave

Status: implemented

## Problem

The 22 packages first-published to npm on 2026-09-26 (local-agent family, quote, inline-html-render, bundles, typesafe pair, room pair, worktrees pair, capability-catalog, capture, dsh-reader, mobile, ui-content-preview) shipped with READMEs rougher than the ten re-released packages: no top language toggle (quote's npm page rendered Chinese-only because npm shows only README.md and the toggle link sat at the bottom of the file), no screenshots, missing standard sections, and stale feature claims. Three packages (room, capability-catalog, mobile) also followed the opposite language convention (English README.md + README.zh.md) from the rest (Chinese README.md + README.en.md).

## Decision

All 22 packages' README pairs were rewritten on the message-tools / ankh-guard template (commit `9ada31d6`):

- Top language toggle on line 3 of both files — mandatory because npm renders only README.md; a bottom toggle reads as single-language.
- Pitch + problem paragraph → screenshots (where the plugin has UI) → Features → Install (add/remove blocks + restart note) → `## Compatibility` (exact English heading in both files, grounded in package.json `dsh.compat`) → Known Limitations → internals in `<details>` → Development → Changelog (only when CHANGELOG.md exists).
- Language convention was subsequently unified to Chinese-primary across all published packages (user decision, same day): room / capability-catalog / mobile were swapped from English-primary (README.md English + README.zh.md) to the common layout (README.md 中文 + README.en.md English), with toggles, package.json `files`, and the apps/ios cross-links moved along.
- Screenshots are referenced by absolute URL under `https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/`; new captures are user-supplied and land before the rc2-aligned re-publish — until then the new img tags are intentionally broken.
- README.i18n.yaml sidecars were re-recorded in the same change (466 pairs in sync).
- Tags (`<dir>-v<version>`) and GitHub Releases for the 22 first publishes point at the post-README HEAD; the npm tarballs still carry the old READMEs and pick the new ones up on the next version bump.

## Alternatives considered

- **Unify all packages to English-primary README.md** — rejected: the ten re-released packages are Chinese-primary, the churn buys nothing once the top toggle exists, and npm audiences reach either language in one click.
- **Hold tags/releases until the rc2 wave** — rejected: tags mark what was actually published; deferring bookkeeping makes the first-publish state unrecoverable.

## Consequences

- npm pages for the 22 packages keep the old READMEs until each package's next version bump (planned with the rc2-aligned wave).
- Repo READMEs temporarily reference not-yet-hosted screenshots; the capture list lives in the session handoff and the images land in the dsh-web-basic mirror before re-publish.
- Follow-ups surfaced by the rewrite (deferred, none blocking): roughly ten packages carry `dsh.compat.verifiedHost: 0.1.5-rc.1` while their devDependencies resolve 0.1.7-rc.1 — bump on the next host-API audit; most first-published packages have no CHANGELOG.md yet; `packages/worktrees/package.json` `dsh.compat.notes`/`description` still mention the retired local-files browser surface; `packages/room-tool/package.json` description names 3 of the 5 registered tools; the official npm line moved to `@deepseek-ai/dsh@0.1.5-rc.3` while READMEs cite `0.1.5-rc.1` (a repo-wide sweep decision, not per-package).
