# Agent Note: package README screenshots live or die by profiles/web-basic — the mirror sync wipes everything else

Status: implemented

## Problem

Package READMEs embed screenshots as absolute `https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/<name>` URLs (npm pages cannot serve relative paths, and dsh-plugins keeps no public raw host of its own). On 2026-09-27, while landing the owner's fifteen new screenshots, we found the hosting arrangement was lossy in both directions:

- **Images vanished after the fact.** The 9/10 mirror commit `fe88b92` ("sync from dsh-plugins") deleted `docs/screenshots/08-local-agent.png` from dsh-web-basic even though four package READMEs referenced it. Cause: `scripts/sync-mirror.mts` (`sync-mirror profile web-basic`) wipes everything in the mirror outside a small keep set and copies back only the files git tracks under `profiles/web-basic/` in this repo. The mirror's `docs/screenshots/` therefore contains exactly the images the *profile* README references (19–20 files); any image committed straight into the mirror "for README image hosting" is deleted by the next sync.
- **Image references with no image.** A dozen READMEs referenced screenshots that had never existed in either repo (aspirational refs from the README rewrite wave) — broken embeds on every npm page.

## Decision

The durable home for a package-README screenshot is **`profiles/web-basic/docs/screenshots/` in this repo, tracked with `git add -f`** (image extensions are gitignored). From there the mirror sync carries it into dsh-web-basic and the raw URL stays alive across syncs. Copying into the mirror directly is still done (so the URL works before the next sync runs) but is no longer the source of truth. `docs/screenshots/` at the repo root keeps its own copies for the doc pages and Agent Notes that reference images locally.

Fifteen owner-provided screenshots (Desktop `截图/`) were mapped onto the existing README references — renamed where the README's planned filename differed (`local-agent-chat.png` → `local-agent-member.png`, `local-agent-member.png` → `room-2.png`, `room.png` → `room-invite.png`, etc.) — and every README `img` line whose screenshot does not exist was **deleted, not left as a 404** (capability-catalog's detail-modal and MCP shots, reader-3, inline-html-card-2, codex delegation, kimi sessions, local-agent-dsh settings, bundle-conversation-toolbox card, both ui-content-preview panels, both mobile shots, typesafe-tool credentials, and datasets' HTML-comment placeholder). Alt texts that no longer matched the actual screenshot (capability-catalog "three-column", inline-html "design-token card", quote-2's composer claim) were rewritten to describe the real image. If one of the deleted slots matters, shoot it and re-add the line — the reference style is one `<img width="640">` line per beat.

Two drift fixes rode along: `packages/quote` had the repo's only bilingual README without a `README.i18n.yaml` sidecar (created; the pairing checker globs existing sidecars, so quote's zh/en drift had been invisible to it), and the stale `m4-room-dev-session.png` was kept in `docs/screenshots/` because two Agent Notes cite it as evidence even though the room README no longer does.

## Alternatives considered

**Host images in a dedicated repo or CDN.** Cleaner separation, but a third moving part for no new capability — the mirror already is public and versioned; the fix was making the sync non-lossy, not moving the host.

**Teach sync-mirror.mts to union instead of wipe.** Rejected for now: the wipe is what makes the mirror an exact projection of `profiles/web-basic/` (a stale file can never survive there). Tracking the images under the profile keeps one mechanism and one source of truth.

## Consequences

- `profiles/web-basic/docs/screenshots/` now tracks 38 images (the 20 profile-README ones + the 18 package-README ones); the mirror holds the same 38 after commit `8c63764`, and the next `sync-mirror` run produces no diff and deletes nothing.
- Any agent adding a README screenshot must land it in `profiles/web-basic/docs/screenshots/` (this repo) — a commit into the mirror alone has a TTL of one sync.
- Every README image reference now resolves: 38 unique `docs/screenshots/` references across `packages/*/README{,.en}.md`, all present in both repos (checked mechanically).

## Testing

`pnpm check:hygiene` clean on all staged files; `verify-translation-pairing` reports 478 pairs in sync (quote's new sidecar included); the reference-existence sweep over both README languages × both repos reports zero misses. Nothing runtime changed — the companion code fix of the day (capability-catalog's default-mode chip tint) shipped separately in `17d3191e`.

## Related

- Same-day README wording pass for the six tool companions: [preset-composed tool rows declare their core as an inject](../bug-fix/2026-09-27-preset-tool-rows-declared-core-inject.md).
