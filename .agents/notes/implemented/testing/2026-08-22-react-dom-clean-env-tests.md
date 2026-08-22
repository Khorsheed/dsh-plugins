# Agent Note: react-dom must be declared — clean-env CI caught a stray-home-directory mask

Status: implemented

English | [中文](2026-08-22-react-dom-clean-env-tests.zh.md)

## Problem

The first CI run that reached the test phase failed in context-guard's client specs: vite could not resolve `react-dom` imported by harness `ui-primitives/src/Menu.tsx`. The same tests were green on every maintainer machine, which made the failure look CI-specific. It was not: the CI environment was the only *honest* one.

## Decision

Eight packages that render harness client components in tests now declare `react-dom` in devDependencies (context-guard, datasets, local-agent, local-agent-dsh, message-tools, mission, session-title-edit, ui-shortcuts), matching each package's `react` version spec, per the existing precedent (message-timeline, taskpilot, ui-file-preview). Rule of thumb: a package whose tests pull in harness client sources — anything `@testing-library/react` touches, or any harness component using portals — must declare `react-dom` itself; `@testing-library/react` lists it as a peer and pnpm does not auto-install peers of transitive deps into the importer.

## Why local was green

Two masks stacked:

- `build/vitest.ts`'s `dshTestConfig` aliases react/react-dom only when resolvable from the calling package — on the maintainer machine the walk-up found a **stray `/Users/<name>/node_modules/react-dom`** (an old home-directory install), so the alias silently existed locally and never in CI.
- With the alias absent, `resolve.dedupe: ['react', 'react-dom']` forces root-based resolution, which fails in any clean environment — exactly what CI reported.

The stray `~/node_modules` is also why several earlier "CI red, local green" puzzles resisted reproduction. When a failure looks environment-specific, reproducing it means replicating the CI *topology* (fresh checkout, harness nested inside the repo, no user-level state) — `/tmp/ci-repro` did this and reproduced the failure in minutes.

## Consequences

- CI is now the authority on dependency hygiene for test-only imports; "green locally" is not evidence when the machine carries user-level state. The reproduction recipe (fresh worktree + nested harness at the tracked tag + `CI=true`) is the reference for any future "CI red, local green" case.
- Maintainers should audit their own machines for stray `~/node_modules` — it masks exactly this class of bug for any tool doing upward resolution.

## Alternatives considered

- **Alias react-dom unconditionally in `dshTestConfig`** — rejected: it would hide genuinely missing declarations again; the honest fix is declaring the dependency.
- **A checker enforcing the declaration** — not built: the CI run is the checker now that CI is green; a dedicated lint would only restate what the clean-env test phase already proves.
