# dsh-plugins

Standalone pnpm monorepo for the @khorsheed-scoped dsh plugin packages, migrated out of the upstream deepseek-harness monorepo.

## Layout

```
packages/    one directory per publishable plugin (@khorsheed/dsh-*)
build/       shared build/test presets (tsdown client bundle, vitest source-plane config)
scripts/     repo tooling (pack-dist, gen-typert, sync-harness-paths)
```

## Commands

```sh
pnpm install
pnpm run build      # pnpm -r --if-present run build
pnpm run test       # pnpm -r --if-present run test
pnpm run typecheck  # pnpm -r --if-present run typecheck
```

Tests must run through the root `pnpm test` or `pnpm --filter <pkg> test` — a bare `pnpm vitest run packages/xxx` bypasses the per-package vitest config (the source-plane alias preset) and fails with misleading resolution errors.

## Dev-time dependency on a harness checkout

Three mechanisms resolve into a local deepseek-harness clone (env `DSH_HARNESS`, default `~/code/deepseek-harness`); the published npm artifacts alone cannot serve them:

- `scripts/gen-typert.mts` regenerates `lib/typert.*` artifacts (message-tools, file-preview, local-agent). The Typert generator's analyzer is monorepo-coupled — Remote marker detection and merged-interface face attribution require every contributing package as a registered workspace *source* package — so generation runs against the harness checkout and the artifacts are copied back with the @khorsheed self-name rewritten in.
- `build/vitest.ts` (the shared vitest preset) maps platform imports onto the harness's `tsconfig.base.json` paths, because published packages ship no `src/` and their `/client` entries are loader-wrapped browser bundles that explode on a plain test import.
- `scripts/sync-harness-paths.mjs` writes taskpilot's gitignored `tsconfig.paths.json` for type resolution (npm release chain incomplete).

CI note: clone deepseek-harness next to this repo and point `DSH_HARNESS` at it before `pnpm test`; a stale harness checkout means the tested API surface may lag the production host.
