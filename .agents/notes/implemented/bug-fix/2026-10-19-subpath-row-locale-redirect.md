# Agent Note: Subpath rows redirect their locale to the package root

Status: implemented

## Problem

After the companion-row folds (`./tool`, `./agent`), the host's settings inventory page showed those rows under bare module names (`local-agent-kimi/tool`) while package-root rows showed localized titles (文件交付工具). The host's `readPluginMeta` resolves `${specifier}/locale/en.json` through the package's exports map and skips the package.json fallback for subpath specifiers (`packages/boot/app-boot/src/package-meta.ts:175-181` in the harness tree), so a subpath row found no locale and the card fell back to the specifier text.

## Decision

Every package whose rows mount a named subpath export adds an exports redirect — `"./tool/locale/*.json": "./locale/*.json"` (or `./agent`) — so the host's resolution lands on the package-root locale dictionary; fourteen packages: datasets, eval, library, local-agent-kimi/-codex/-claude-code, mission, room, typesafe, video-studio, worktrees (the `./tool` rows), canvas, canvas-novel, game (the `./agent` rows). The convention is pinned in AGENTS.md's display-metadata rule. In the same pass the four local-agent providers' settings config-card titles (client `locales.ts`) were aligned with their plugin-manager card titles (Kimi 委派 / Codex 委派 / Claude 委派 / DSH 委派). `docs/upstream-proposals/2026-10-19-subpath-specifier-meta-fallback.md` (a gitignored working document) asks the host to fall back to the bare package name's locale for subpath specifiers; the redirects can retire if that lands, and are harmless to keep.

## Alternatives considered

**Per-subpath locale files with their own titles.** Rejected: it duplicates the dictionaries once per row for zero user value — the row IS the package's tool surface and should wear the package's name.

**Prettier row ids or module specifiers.** Rejected: ids are load-bearing identity (composition state, user-layer overrides, parity specs); cosmetics never justifies breaking them.

**Wait for the host fix.** Rejected: we do not fork the host and the proposal has no landing date; the redirect works on today's host line.

## Consequences

- Exports maps gain one inert key per subpath row; runtime loading is untouched (per-package resolution probes confirm en+zh land on the root dictionary and the `./tool`/`./agent` entries still resolve).
- `local-agent-dsh-headless` mounts a `/startup` row but ships no `locale/` directory at all — a convention gap, left for its owner because that patch must never enter an interactive profile (its rows never face the inventory page there).

## Testing

Per-package `require.resolve` probes: every redirected `./tool|./agent/locale/{en,zh}.json` resolves to the package-root file (previously `ERR_PACKAGE_PATH_NOT_EXPORTED`), and the row entry exports still resolve. `pnpm check:plugins` green over 48 packages.
