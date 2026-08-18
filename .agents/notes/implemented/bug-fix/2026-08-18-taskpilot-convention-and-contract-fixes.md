# Agent Note: taskpilot convention and contract fixes (client bundle helper, invariant name, peer deps)

Status: implemented

[English](2026-08-18-taskpilot-convention-and-contract-fixes.md) | 中文

## Problem

A review of `@khorsheed/dsh-taskpilot` surfaced three contract violations plus one
latent breakage they hid:

1. **Hand-rolled client bundle.** `tsdown.config.ts` hand-wrote the
   `window.__ModuleLoader__.load` banner/footer, its own CSS-modules plugin, and a
   frozen copy of the platform-module table, instead of the shared
   `clientBundle` helper (`build/tsdown.client.ts`). The frozen table can drift
   from the shell's seed table, and the hand-rolled config skipped the bundle
   purity gate and the host/client build-face split.
2. **Bare invariant name.** `src/invariant.ts` registered the invariant under
   `'dsh-taskpilot'` — neither the npm package name nor the companion-plugin
   naming convention. The invariants service documents that the registered name
   is the **full npm package name** that owns the contribution; siblings register
   `@khorsheed/dsh-*` under a distinct `<short>-invariant` companion name.
3. **Host type deps undeclared.** The host half imports Context merges and
   brand types from `@deepseek-ai/dsh-agent`, `dsh-commands`, `dsh-jobs`,
   `dsh-session`, `dsh-subagent`, `dsh-invariants` (and the client half from
   `dsh-api-remotes`, `dsh-client-*`), but `peerDependencies` declared only
   `cordis` and `react`. The package compiled only through the gitignored,
   machine-generated `tsconfig.paths.json` — a consumer installing the tarball
   had no declared contract to satisfy.
4. **Latent breakage:** because the hand-rolled node config emitted only
   `lib/index.js`, `lib/invariant.js` was never built, while `exports["./invariant"]`
   pointed at it — the `./invariant` subpath export was dangling in every artifact
   (confirmed: the rc.6 tarball and `lib/` lacked `invariant.js`).

## Decision

- `tsdown.config.ts` becomes the one-liner
  `clientBundle('@khorsheed/dsh-taskpilot', ['lib/types/index.js', 'lib/types/invariant.js'])`.
  The preset now owns the loader handoff, the platform external table, the
  CSS-modules pipeline, the purity gate, and face selection; the lib entry list
  restates `lib/types/invariant.js` so the node half emits it.
- `src/invariant.ts` follows the sibling shape: companion
  `export const name = 'taskpilot-invariant'`, `inject = ['invariants']`, and the
  registration passes the full `PACKAGE_NAME = '@khorsheed/dsh-taskpilot'`.
- `package.json` declares every imported official package as a peer dependency
  (`^0.1.0-rc.6`, the repo-wide caret floor), matching message-tools /
  session-title-edit: `dsh-agent`, `dsh-api-remotes`, `dsh-client-locale`,
  `dsh-client-runtime`, `dsh-client-ui-conversation`, `dsh-client-ui-layout`,
  `dsh-client-ui-primitives`, `dsh-client-ui-slots`, `dsh-commands`,
  `dsh-invariants`, `dsh-jobs`, `dsh-session`, `dsh-subagent` (+ existing
  `cordis`, `react`). The generated-paths map stays as the dev-time resolution
  mechanism until the product release chain is complete; the peer declaration is
  the consumer-facing contract.
- The host plugin name in `src/index.ts` moves from `'dsh-taskpilot'` to
  `'taskpilot'` (sibling host-half convention: local-agent, ankh-guard).
- Fix release `0.1.0-rc.6.1` (the repo's `rc.6.N` fix-release line, per
  ankh-guard's `0.1.0-rc.6.6` precedent); tarball repacked and verified.

## Alternatives considered

- **Keep the hand-rolled config and only fix the invariant name** — rejected:
  the frozen platform table and skipped purity gate are exactly the drift the
  shared helper exists to prevent; the helper is the repo's load-bearing
  convention for browser bundles.
- **Register the invariant under the short name `taskpilot`** — rejected: the
  invariants service contract requires the full npm package name (it is what the
  allowlist/blocklist filters and `InvariantError.packageName` report).

## Consequences

- `lib/invariant.js` is now emitted; the `./invariant` export resolves.
- The client bundle passes the purity gate and shares the shell's platform
  external table (no frozen copy to maintain).
- The invariant companion reserves `@khorsheed/dsh-taskpilot`; the host plugin
  displays as `taskpilot`.
- npm consumers get a complete, satisfiable dependency contract; dev-time
  resolution still rides `sync-harness-paths.mjs` until the product release
  chain is complete.
