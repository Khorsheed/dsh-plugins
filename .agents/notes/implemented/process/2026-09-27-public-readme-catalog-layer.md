# Agent Note: the public README layer is a published-only catalog — root maps capabilities, packs showcase, numbers defer to generated docs

Status: implemented

## Problem

Ahead of making dsh-plugins, dsh-basic, and dsh-web-dev public, the three READMEs had drifted out from under their own claims:

- **The root README was an install manual, not a map.** It led with "32 packages, 25 self-mounting" when `docs/packages.md` (machine-generated) already read 43 / 34; it announced local-agent as "awaiting publication" when the family had been on npm at 0.1.0-rc.7 for weeks; and ~20 packages (quote, dsh-reader, mobile, capture, typesafe, capability-catalog, room, worktrees, the two family bundles, …) never appeared at all. Its seven deep-dive sections duplicated the per-package READMEs and were the fastest-rotting part of the file.
- **dsh-web-dev's README described a pack that no longer existed**: "21 members, 13 not on npm" against a real dependency list of 23, all published; four screenshot placeholders had been pending since the file was written.
- **dsh-basic's README was structurally right** (positioning → install → member table → per-plugin tour with screenshots) but had no hero image and no pointer to the sibling pack.

The owner decided the public shape up front: dsh-plugins reads as a systematic capability + preset-design overview (the PerryLink profile's catalog style); the two pack repos read as "what the bundle gives you, which plugins, with screenshots"; only published packages appear; no metrics badges; web-dev's missing screenshots come from the existing asset pool.

## Decision

**The root README is a catalog, and everything it says is either a table row or a link.** Structure: positioning paragraph → the three-profile comparison table (the hub that routes readers to the packs) → the capability map (33 published packages in ten category tables, each row linking the package directory, one line of "what you get", and the pack membership) → the agent-preset design (the three rules: session-granted tool rows, grant-following UI self-hide, purely additive declarations — plus the dev / dsh-eval / dsh-writing preset cards) → compatibility promise → model-impact table → slim install/uninstall → development. The seven deep-dive sections were deleted, not moved: every package already carries a bilingual README with the same depth (message-tools 86 lines, ankh-guard 223, local-agent 187, …), and the aggregate claims that must stay (the model-impact table, the uninstall rules, the ankh-guard duplicate-row warning) remain in place.

**Numbers the repo can regenerate are never hand-written in the README.** Package counts, publish state, and host-compatibility claims point at `docs/packages.md` and `docs/release-status.md` (both machine-generated and gate-checked) instead of restating figures that drift. The one deliberate exception is the member counts in the profile comparison table (10 / 23 / 26), which the pack READMEs themselves also carry.

**Unpublished incubation work is invisible from the public face.** canvas, sidechat, datasets/eval/mission/lab, and `@khorsheed/dsh-presets` do not appear in the capability map. The preset section describes the three presets as they are actually delivered today — directory-style presets installed by the packs' `install.sh` — and names `packages/presets` only as the not-yet-published 0.1.7-line mechanism, never with an install command.

**The pack READMEs are the showcase layer.** basic gained a hero image (`file-preview1.png`, already tracked) and a related-packs table — nothing else moved. web-dev was rewritten around the corrected membership (23 packages in four layers: the 9 baseline + ankh-guard + 3 experience extras + 10 development) and its four screenshot placeholders were filled from the existing pool: `web-dev-overview.png` ← room-1, `local-agent-delegation.png` ← 08-local-agent, `local-agent-member.png` ← local-agent-member, `worktrees-drawer.png` ← worktrees-tab, `room-members.png` ← room-2. Per the [screenshot-hosting note](2026-09-27-readme-screenshot-hosting.md) the images live tracked under `profiles/web-dev/docs/screenshots/` (`git add -f`) so the mirror sync carries them into dsh-web-dev; they are byte-copies of the basic pool, which stays the canonical host for package-README embeds.

**Install guidance follows the host's 0.1.7-rc.2 "Add plugin" dialog, with its limit spelled out.** Verified against `packages/boot/plugin-manager` in the harness checkout: the dialog and `dsh plugin add` share one pnpm backend; a git URL installs only the repository-root package (no monorepo subpath syntax, no workspace probing), and a repo whose root is not a `dsh.bundle` plugin — this monorepo, or a pack's profile-template repo — is refused with `not-bundle` and rolled back. There is no official entry that installs a whole profile pack. The READMEs therefore route packs through their clone + `install.sh` scripts (with an explicit "the dialog cannot install this repo" note), and point single-package installs and member add/remove at **Settings → Plugins → Add plugin** by package name as the no-CLI path on host ≥ 0.1.7-rc.2.

**basic's body leads with copy-name single-plugin install; the whole-pack install folds to the end.** The owner's call, from observed usage: most real installs are a user picking one plugin and pasting its name into the host dialog, so the body is three parts — why the pack exists (everyday UX plugins; self-used and open-sourced; explicitly designed to be obsoleted member-by-member as the official GUI closes each gap), the member table with copyable package names plus a host-version → release-line compatibility table (the 0.3.x line of five members needs host ≥ 0.1.5-rc.1, 0.1.2-line hosts pin `@^0.2.0`, 0.1.x hosts pin `@^0.1.0`), and the per-plugin tour where each section carries its package name and compat line instead of an install command. All install machinery — line selection, the pack scripts, the same-port handover, and the single-package CLI form — collapses into one trailing collapsed "Install guide for agents" that agents and manual users share.

**basic grew to 13 members and its ranges now track the lines the README promises.** capability-catalog, inline-html-render, and mobile joined the pack; because capability-catalog and mobile have no pre-0.1.5 line at all, the pack's floor moved to host 0.1.5-rc.1, which also resolved the stale-range contradiction in the only coherent direction — the five members pinned at `^0.2.0` while their latest lines had moved to 0.3.x now pin `^0.3.2` (the pack's own 2026-09-27 changelog already told users those versions were what "updating the pack" delivers). 0.1.2-line hosts keep the pre-update archive (a `host-0.1.2-line` tag ships with the next wave), 0.1.x hosts keep `host-0.1.1-line`.

## Alternatives considered

**Keep the deep-dive sections in the root README.** Rejected: they duplicate the per-package READMEs under a second roof, and the file's rot (32-vs-43 packages, unpublished-vs-published family) was concentrated exactly in prose that restated facts owned elsewhere. The catalog form has one writable fact per row.

**List the incubating packages in a marked section.** The owner chose not to: the public README lists only what `dsh plugin add` can install today, and the list is refreshed per publish wave. The preset designs still get their section because presets ship inside the packs, not as the unpublished bundle.

**Shoot fresh screenshots for web-dev.** Deferred by the owner: the basic pool already held accurate shots of every web-dev headline feature (room, worktrees, local-agent settings cards, member channel), so the placeholders were filled by copying. A dedicated shoot can replace them any time — the filenames are stable.

**Quantified badges (npm downloads, stars).** Rejected by the owner: numbers that need maintenance buys nothing a catalog row doesn't already say.

**Meta-bundle each pack so the 0.1.7-rc.2 "Add plugin" dialog can install it.** Rejected by the owner: with a meta-bundle the members become transitive npm dependencies of the bundle package, so per-member uninstall is lost — `dsh plugin remove` and the manager page operate on the profile's direct dependencies only, and a member row could at best be disabled, never removed. Per-member removal is the pack's core promise ("the bundle is a starting point, not a lock-in"), and the dialog's single-package form cannot deliver it. The packs therefore stay profile-shaped with the script-based install; if the upstream host later grows a profile-type install entry, the packs adopt it and the READMEs gain the one-shot path.

## Consequences

- The root README's factual surface is now: one count sentence (43/33, restated from the generated docs), the member-count table, and category tables whose rows are package-directory links. Everything else regenerable is a link.
- `profiles/web-dev/docs/screenshots/` exists and tracks five images; the next `sync-mirror profile web-dev` carries them. The basic pool is untouched and remains the npm-embed host.
- Both profile README pairs were re-recorded (`verify-translation-pairing --write`); the root pair has no sidecar by design (the pairing glob covers `packages/`, `profiles/`, `.agents/`, `docs/` only).
- **Known follow-up outside this change:** the pack dependency ranges predate the current publish lines — basic pins `^0.2.0` while members publish 0.3.x, and web-dev pins `^0.1.x` where the local-agent family exists on npm only as `0.1.0-rc.7` prereleases, which a bare `^0.1.0` does not admit. The ranges (or the family line) need a refresh pass before dsh-web-dev is announced installable; the README now states the npm-published status, and making that claim true end-to-end is release work, not prose.

## Testing

Docs-only change: `pnpm check:hygiene` on the staged set; `verify-translation-pairing` re-recorded and green for both profile pairs; every image referenced by the three READMEs exists tracked in the corresponding profile's `docs/screenshots/`.
