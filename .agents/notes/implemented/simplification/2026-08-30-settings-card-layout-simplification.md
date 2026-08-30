# Agent Note: Live settings card drops the override badge row; the live switch joins its label row

Status: implemented

English | [中文](2026-08-30-settings-card-layout-simplification.zh.md)

## Problem

Product feedback on the live settings card (screenshot review): the "已覆盖部署默认（yaml：…）" badge plus the "恢复默认" button read as over-engineered for a card with exactly two settings — a user who wants the deployment default back just toggles the switch/radio. Separately, the "常驻模式（live）ⓘ" section header and the "启用 + switch" row wasted a line: the switch belongs on the same row as its label, exactly like the "输出粒度" row below it.

## Decision

- **One row for the live switch.** The `blockTitle` header is gone; the row is now `常驻模式（live）ⓘ + switch`, structurally identical to the granularity row (label + ⓘTooltip + control). The switch's aria-label moves from `live.enable` to `live.title`.
- **The override row is removed.** No more `overridden`/`baseLayer` helpers, `reset`, `yamlParts`, the badge/reset JSX, the `.overrideRow`/`.badge`/`.reset` styles, and the `live.enable`/`live.overridden`/`live.reset` locale keys (zh + en). The three-layer merge (yaml base ← user layer) is unchanged — the user layer simply no longer advertises or bulk-clears itself.
- All four provider cards (kimi template, replicated to codex / claude-code / dsh) change identically; dsh's separate `enabled` master-switch section is untouched.

## Alternatives considered

**Keep the badge but only when a yaml base exists** — rejected: the product call is that two toggles need no provenance UI at all; a conditional badge keeps the code paths (override detection, reset, locale keys) for a hint nobody acts on.

**Keep 恢复默认 as an icon button** — rejected for the same reason: manual toggling is two clicks.

## Consequences

The card body is two rows (live switch, granularity radios) plus the auth block; the saved/error/unavailable hints are unchanged. The two badge tests per package are removed (suites: kimi 120, codex 93, claude-code 87, dsh 88 — all green). Users who previously set a user-layer override keep it (the data model is untouched); the only way back to the yaml value is now the manual toggle, which is the intended simplification.
