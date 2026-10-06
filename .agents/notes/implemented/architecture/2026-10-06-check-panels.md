# Agent Note: check:panels — the machine-checkable half of the panel spec

Status: implemented

## Problem

The panel spec (docs/panel-design.md) is about to be handed to the canvas owner, who will adopt it working only from the doc. Prose alone gives neither the owner nor the reviewer a way to tell whether an adoption is done, and nothing would stop a later change from quietly undoing one. Most plugins have not adopted the kit yet, so a checker that failed on every non-conforming package would turn the gate red on day one.

## Decision

`scripts/check-panels.ts` (`pnpm check:panels`, also a gate step after plugin independence) scans every package carrying `dsh.client`, only its `src/client` CSS and TS. A package counts as **adopted** once any dependency field names `@khorsheed/dsh-client-ui-panel-kit` (source-plane, so in practice a devDependency). Only an adopted package's errors fail the run; a not-yet-adopted package prints one line of hints. The tree is green today, and a package becomes enforced the moment it adopts the kit.

Rules, ids fixed because the doc cites them:

- errors: `panel-root` (PanelRoot or the kit-based ContentPane, or `container-type: inline-size`), `compact-layout` (PanelHeader or ContentPane, or a 560px `@container` rule), `token-fallback` (every `var(--dsh-panel-…)` has a fallback), `no-mobile-import` (no source import of, and no dependency on, `@khorsheed/dsh-mobile`);
- warns: `literal-color`, `hover-only` (a heuristic), `small-touch-text` (under 13px inside coarse-pointer or 560px blocks), `fixed-overlay` (the reader's add dialog was pushed past the phone shell's edge by `position: fixed`).

A warn is silenced for one line by `panel-check: allow-<what>` on that line or the one above. Output is Chinese, grouped by package, each finding carrying the rule id, `file:line`, and a one-line fix pointing at the doc section. `--package <dir>` lists every finding, hints included, for one package; `--json` is machine-readable.

`browserOnHost` moved from ui-content-preview into the kit (`src/client/host.ts`): "is the viewer at the host" is a panel-wide question, not a preview-kernel detail. ui-content-preview, local-files and file-preview import it from the kit, with no copy left behind.

## Alternatives considered

- **Fail every non-conforming package now.** Rejected: canvas and twenty-odd other packages would turn the gate red before anyone adopts anything.
- **Opt in through a manifest flag.** Rejected: the kit dependency already says the package adopted the spec, and a second flag can drift from it.
- **Make literal colours an error.** Rejected for now: adopted packages carry dozens of existing literals (worktrees alone has 19 warns). Warn and allow-marker first; promote it once the stock is cleaned up.

## Consequences

- At commit time the adopted packages are local-files, dsh-reader, file-preview and worktrees, all at 0 errors, with 1, 5, 0 and 19 warns respectively.
- Adopting the kit in canvas makes its current findings (no width container at the root, 9 warns) binding immediately; that is the intended moment of enforcement.
- The spec re-runs the checker against the real tree (adopted packages at 0 errors), so `pnpm test:scripts` catches a regression even outside the gate.

## Follow-up (P3 acceptance, 2026-10-06)

Adopting the kit from the docs alone, the canvas owner found that the release build hashed CSS Modules container names per file: a plugin's `@container dsh-panel` never matched the container `PanelRoot` declares, so every compact rule was dead in production, invisible to source-level checks and to the vite-served examples (which do not hash). The build fix lives in `build/tsdown.client.ts` (container names stay global). Added here:

- **New rule `container-match` (error, adopted packages only)**: reads the built `lib/client.js`; every `@container <name>` query needs a same-named declaration (`container:` / `container-name:` / an inline style). No bundle, or one older than the sources or the shared build config, is an `info` and is skipped — neither a pass nor a false failure. The gate re-runs check:panels after its build step so the fresh bundles are what get checked.
- **New rule `desktop-font` (warn)**: a `font` / `font-size` reading a host desktop size token (`--dsw-font-xs-*` and kin), exemptable with `allow-desktop-font`. Origin: the canvas switch row pinned at xxs-12, which never grows on a phone. canvas and canvas-novel carry over a hundred each, left for their owner to fix from the docs.
- **One count**: the per-package line, the summary line and `--json` all read `countReport` / `totalsOf`; the summary now reads "adopted: E errors, W warns; not adopted: H hints", and the spec asserts all three agree. `info` is never counted.
- **`panel-root` accepts the `container: <name> / inline-size` shorthand.**
- **ui-panel-kit**: `ChipRow` gains `tools` (pinned right, outside the chip scroll) and the canvas board's mark-all-seen / manage-categories moved into it; `UnderlineTabs` gains a per-tab `badge` (beside the label, outside the underline), a row-end `trailing` slot sharing the tabs' one bottom rule, and a 44px coarse-pointer height. Per the coordinator, canvas's switch row, its ⋯ placement and the 章节 badge were NOT migrated: the canvas owner does those from the docs (a test of the docs).
- **docs/panel-design.md**: the screenshot self-check is two layers — example page (touch emulation + `data-dsh-mobile` + `MOBILE_CSS`) and the real build — with the 10-06 lesson; actionable entity cards may keep card styling; ⋯ / tools go in the component's slot, no extra divider; no host desktop size tokens; the two new rules in the table; canvas as a reference; stale `lib/types` after a rename blocks deploys.
