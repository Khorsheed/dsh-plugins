# Agent Note: the plugin-upgrade skill package — host-upgrade self-guidance distilled from the 0.1.2 wave

Status: implemented

English | [中文](2026-08-30-plugin-upgrade-skill.zh.md)

## Problem

The 0.1.2 adaptation wave produced a hard-won method for moving an instance across a host release: fetch the new host into a separate checkout, inventory the breakage surface (externalized value imports, moved data slices, deleted named exports that still typecheck), fix dual-line, verify on a live acceptance boot, then self-restart with resume. That method lived only in agent notes and commit history — an agent inside a fresh instance asked to "upgrade this instance" had no way to discover it. The upstream community call for an official upgrade skill makes the gap public: anyone upgrading a deployment past a host bump faces it, not just this repo.

## Decision

A new skill-only package `@khorsheed/dsh-plugin-upgrade` (`packages/plugin-upgrade`) ships the method as a registered skill. Form decisions:

- **Skill-only, no client face.** The host half does exactly one thing — register the `plugin-upgrade` skill from the shipped bundle `skills/plugin-upgrade/` (read at apply, `source: 'runtime'`, `provider: 'plugin-upgrade'`, `resourceBase: { kind: 'directory', path: skillDir }` so the catalog lists the bundle, the a6afaf6 pattern). Registration waits for the registry via `ctx.inject(['skills'], …)` (the inline-html-render fix), and a missing/unreadable bundle degrades to a warning — a discovery aid never takes a boot down. Unlike ankh-guard there is no state-dir registration record: the package owns no state.
- **SKILL.md is the product.** English, imperative, phased: ground rules (never edit the running checkout; probe features, never versions; green typecheck is not runtime-clean) → baseline → fetch the new host beside the old (worktree/npm staging) → breakage inventory → dual-line fix discipline → verification ladder (package → composition → live acceptance on a fresh home with zero plugin console errors → delivery from the README) → self-restart (ankh-guard path when present, else handoff note + detached supervisor) → failure fallback.
- **Depth lives in the bundle, not the body.** `reference/breakage-checklist.md` (the twelve-surface inventory + compile-time blind spots) and `reference/dual-host-fix-patterns.md` (namespace-import probing, brand-type anchoring, inline-if-self-contained, dual-seat readers) carry the detail SKILL.md summarizes; `assets/restart-resume.sh` is the generalized detached supervisor (wait for old pid → boot new host → health-check → roll back to the old launch command), parameterized by env, generalized from the basic restart script with all profile-specific logic removed.
- All content is generalized: no repo paths, no machine paths, no instance specifics — the skill assumes the reader knows nothing about this monorepo.

## Alternatives considered

- **A tools-bearing package** (register model-visible `upgrade_*` tools instead of a skill) — rejected: the method is judgment-heavy prose (release-note reading, migration-map building), not callable operations; a skill is the right grain, and it is what the upstream call asks for.
- **Fold the skill into ankh-guard** — rejected: ankh-guard is the restart gate, installable only where a watchdog makes sense; the upgrade runbook is useful on guard-less instances (its Path B exists precisely for them) and must not require the guard.
- **Put everything in SKILL.md** (no reference/ or assets/) — rejected: the checklist and fix patterns would bloat the always-loaded body; the bundle-directory registration exists exactly so detail loads on demand.

## Consequences

- Community instances gain a one-sentence upgrade path ("upgrade this instance to X") without any host change; the tarball is self-mounting and the skill self-registers.
- The pack-smoke test owns the bundle's presence in the tarball (SKILL.md + reference/ + assets/); the registration spec pins `source`, `provider`, `resourceBase`, and the description's trigger words.
- The supervisor script is a template an agent parameterizes per instance — it deliberately knows nothing about ankh-guard, ports, or profiles; when the guard IS present the skill routes to it instead.
- Maintenance: the checklist and patterns describe classes of breakage, not the 0.1.2 wave's specifics, so the skill should age slowly; concrete wave findings stay in the architecture notes where they belong.
