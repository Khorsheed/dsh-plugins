# Agent Note: CI harness seed builds the native flock addon

Status: implemented

[English](2026-09-11-harness-native-flock-ci-seed.md) | [中文](2026-09-11-harness-native-flock-ci-seed.zh.md)

## Problem

Both CI lanes (gates and next-compat, ubuntu-latest) went red on `packages/room`'s `tests/persistence.host.spec.ts`: all three cases failed with `Cannot find module '…/native/system/packages/linux-x64/bin/glibc/system.node'`, required from the harness's `native/system/packages/entry/src/flock.ts`. The room journal persistence tests run on the host persistence layer (`session-persistence-jsonl`), which flocks its journal through the native addon `@deepseek-ai/node-addon-system-linux-x64`.

That addon's `.node` binaries are not in the harness git tree. They are compiled per host platform by `native/system/scripts/build.ts` (root script `build:native-system`, which passes `--host-addon-only`) straight into each platform package's `bin/`. The platform package manifests are committed, so `require.resolve('…/package.json')` succeeds while `bin/` stays empty — exactly the CI symptom. Local macOS runs were green only because local harness checkouts had been built or tested there before (the harness root `test` script runs `build:native-system` first). The CI seed steps (`pnpm install --frozen-lockfile`, `pnpm run build:lib`) never compile native code.

## Decision

Both CI jobs gain a `Build harness native addon (flock)` step immediately after `Build harness libs (type seed)`, running `pnpm run build:native-system` in the harness checkout. With `--host-addon-only`, the script compiles only the runner's own Node-API flock addon (`bin/glibc/system.node` on ubuntu-latest) with `cc` and the Node headers shipped by actions/setup-node. It skips the musl flock variant and the static-musl Landlock launcher, so no musl toolchain or cross-compilation is needed; the step is a single small C compile.

The step is duplicated verbatim across the two jobs rather than extracted into a composite action, matching the workflow's existing convention — the install and build:lib seed steps are already duplicated the same way, and the next-compat job deliberately shares only harness-sensitive steps.

## Alternatives considered

**Skip the persistence tests when the native binding is absent (test-side degradation).** Rejected: it would silently drop the journal-persistence coverage from CI — the layer where these tests are most valuable, since only CI exercises the Linux flock path (local development runs on macOS). Provisioning the binary turned out to be one cheap command, so the coverage loss was not buying meaningful simplicity.

**Check the prebuilt binaries into the harness repo, or fetch them from a release artifact.** Not ours to change: the harness is upstream and read-only to us; its maintainers deliberately build from source (the release pipeline assembles prebuilds only for the published npm packages). A fetch step would also pin CI to upstream's release cadence for a file we can compile in seconds.

**Build the full native suite (without `--host-addon-only`).** Rejected: on Linux that also builds the static-musl Landlock launcher, which requires `musl-gcc` — an extra apt dependency and a longer, more fragile step for a binary the plugin tests never load.

## Consequences

CI keeps the real journal-persistence coverage on Linux, at the cost of one extra workflow step per lane (a few seconds of `cc`). The step depends on two upstream facts that can drift on the forward line: the `build:native-system` script name and its `--host-addon-only` semantics. If upstream renames them, the next-compat lane reports it first (it is continue-on-error); the gates lane is pinned to `dsh-v0.1.5-rc.1`, where the script is verified to exist and work.
