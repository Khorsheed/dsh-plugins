# Agent Note: video-studio — sherpa-onnx-node must be a declared runtime dependency

Status: implemented

## Problem

On prod 3080 every transcription job failed with `Cannot find module 'sherpa-onnx-node'`. The package declares the dependency and works in the dev checkout, but pack-dist strips `dependencies` from the dist manifest (runtime deps are expected to be bundled into `lib/` or host-provided), so the installed tarball carried only `zod`. sherpa-onnx-node cannot be bundled: it is a prebuilt per-platform native addon that the forked speech worker `require()`s at runtime from the install tree.

## Decision

Declare it in `package.json` under `dsh.runtimeDependencies` (`["sherpa-onnx-node"]`) — the existing pack-dist escape hatch (the capture package's `@puppeteer/browsers` / `puppeteer-core` precedent): named entries survive the manifest rewrite verbatim, so the profile installs the addon alongside the package and the worker's require resolves through the package's own `node_modules`.

## Alternatives considered

- **Bundle sherpa-onnx-node into lib/**: rejected — the JS wrapper locates a platform `.node` binary relative to its own path; bundling breaks that resolution and multiplies tarball size per platform.
- **Resolve the module from the dev checkout path**: rejected — prod must never see a dev path, and the profile is the unit of installation.

## Consequences

- The fix only reaches prod on the next `pnpm deploy:3080 --package packages/video-studio`; installs before it keep failing transcription with the same error.
- Any future native/unbundleable runtime dependency of this package belongs in the same list — naming something absent from `dependencies` fails loud at pack time.

## Testing

`pnpm --filter @khorsheed/dsh-video-studio build` + package tests green (29/29). pack-dist's keep-list logic is covered by the scripts suite; the failure itself was environment-level (missing install), verified by inspecting the deployed manifest at the prod profile.
