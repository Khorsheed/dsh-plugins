# Agent Note: 包管理——分类、整合包形态与发布流程

Status: proposed

English | [中文](2026-08-21-package-management.zh.md)

## Problem

The repo is at first-publication threshold (20 packages; only ankh-guard is on npm — latest 0.1.0-rc.8.9 — as of 2026-08-21, the rest unpublished), yet there is no concrete plan tying plugin classification to distributable integration packs to a release process. [plugin-ops-model](../../implemented/process/2026-08-20-plugin-ops-model.md) settled the three-environment lifecycle and sketched a thin meta-pack, but left the meta-pack's name/versioning and its actual mechanics open. Contract verification against the harness (`apps/cli/src/plugin.ts`, `packages/boot/app-boot/src/profile.ts`) shows the current CLI cannot mount a thin pack: `pnpm add <pack>` writes only the pack as a direct dependency, and `reconcilePlugins` scans only direct dependencies — members install but never mount. Any plan that assumes the ops.md "thin meta-pack" line works today is building on a gap.

## Proposal

Treat package management as one capability tracked in [proposals/active/2026-08-21-package-management.md](../../../proposals/active/2026-08-21-package-management.md) and its upstream seam in [proposals/active/2026-08-21-upstream-meta-pack-reconcile.md](../../../proposals/active/2026-08-21-upstream-meta-pack-reconcile.md):

- **Classification**: every package gains a `dsh.category` (`base` / `domain` / `ops`, single primary label; `dsh.domain` notes like `eval` for domain packs), mirrored in the README master table. Classification is a label, never a physical bundle. The inventory matrix also tracks host compat (`minHost` floor / informational `latestHost` defaulting to minHost, to become `dsh.compat.latestHost`), the npm-published version (registry is the source of truth), the shared GitHub repo (per-package `packages/<dir>`; message-timeline still lacks the `repository` field), and the bundle-vs-plain distinction (19 bundles + tool-subagent plain).
- **Distribution forms**: A — add-list script (works today); B — profile directory template shipped as repo/tgz, members as direct deps (works today, recommended for the first pack); C — npm thin meta-pack (target form, blocked on the upstream seam).
- **Release process**: independent lines per package (first release has no ordering issue except the local-agent family co-release); integration packs use `^` ranges and bump only on membership or major-line changes, not per member patch release.
- **First application**: `dsh-eval` pack (datasets + lab + file-preview pair + client-message-tools + taskpilot + base layer minus ankh-guard) via form B; `dsh-novel` waits for novel-domain plugins.

## Alternatives considered

- **Fat meta-pack (own patch inserting every child row)** — rejected in plugin-ops-model and kept rejected: removing one child fights pack-owned rows and breaks the one-package-one-row self-mounting convention.
- **Literal per-audience profiles as the distributable** — rejected: profiles bind to a machine's `$DSH_HOME` and node_modules; the pack (directory template or npm thin pack) is the distributable, the profile is the assembly site.
- **Bump the pack on every member patch release (ops.md's line)** — rejected in favor of caret ranges + membership-only bumps: fewer releases, same safety since members self-declare compatibility.
- **Upstream design 1 (expansion) vs design 2 (closure scan + exclude list)** — design 1 recommended in the seam proposal: no new manifest state, reuses native pnpm remove; design 2 kept as the minimal-change fallback if upstream prefers it.

## Acceptance criteria

- Classification is mechanically checkable (`dsh.category` present and consistent with README).
- A fresh profile installs the dsh-eval pack in one command (form B script/template now, form C `dsh plugin add <pack>` once the seam lands); any single bundle `remove` leaves the rest intact and the instance boots clean.
- At least one package completes the full chain pack-dist → npm publish → consumer smoke test; the pack reproduces from a fresh profile.

## Risks

- Upstream rejects the seam → form C stalls; forms A/B carry the packs long-term and the gap registers in the upstream seam registry. Not a blocker for delivery.
- Classification subjectivity (datasets spans base and eval) → single primary label plus `dsh.domain` note, no tag explosion.
- Caret-range drift in packs → members self-declare `dsh.compat`; packs tighten ranges on major-line bumps.
- Working-tree churn: this note and its proposals are doc-only; the inventory milestone (M1) touches package.json `dsh.category` fields and must respect concurrent agents' in-flight package work.
