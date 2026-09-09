# Agent Note: dual-filesystem deployments pin `headlessBundleDir` — the bundle's peers must resolve from the installation that runs it

Status: implemented

English | [中文](2026-09-09-dsh-headless-bundle-dual-filesystem-pin.zh.md)

## Problem

`provisionDshSubProfile` writes `<scoped home>/profiles/<name>/node_modules/@khorsheed/dsh-local-agent-dsh-headless` as an absolute symlink into the host installation. Correct in a pure-host world. Under the T20c "one owner, one directory" layout the SAME scoped home is bind-mounted into container units, and the absolute target dangles there — the sub-dsh profile fails to boot (`failed to apply loader entry include`). The README's container-round provisioning skip only prevents writing a NEW bad link; it cannot fix the one already written, and a host-side readiness re-probe re-provisions and writes the host-only path back — right before a container round mounts the directory. One directory is now parsed by two filesystems whose dependency closures live in different places (host: the profile's installation; unit: the image's `/opt/dsh-headless/node_modules`).

Three roads were on the table: (1) copy the bundle and its runtime closure into the scoped home with a relative link; (2) give the unit a second mount; (3) have the caller pin `headlessBundleDir` to a path that exists on both sides.

## Decision

**Road 3, formalized as a documented contract — zero code change.** The config key `headlessBundleDir` already exists; what was missing is the contract: when a scoped home is resolved by more than one filesystem, pin it to an absolute path valid in all of them (host: a same-named symlink into the host installation's bundle; image: the real installation at the same path). Once pinned, a readiness re-provision merely rewrites the same target, and the race the report described disappears. Both READMEs now carry the contract next to the container-delegation section, and the config table row points at it.

Why not road 1 (the initially attractive "self-contained directory"): family code imports RUNTIME service keys and classes from `@deepseek-ai/*` — `credentialRef` (dsh-credentials), `TypertRemoteService`/`Remote` (dsh-typert-protocol), `SessionId` (dsh-session), `settingsNamespace`, `scrubbedParentEnv`. A copied closure creates a SECOND instance of those packages next to the loader's own, and cordis does service lookup and type checks by instance identity: the symptom would be silently missing services and degraded plugins, not a boot error. Copying only the family packages fails instead at resolution — Node's walk-up from the scoped home never reaches the installation's `@deepseek-ai/*`. The bundle's official peers must resolve from the SAME installation that runs the sub-dsh; pinning preserves that invariant in both runtimes, copying necessarily breaks it. (The singleton invariant is what road 3's measured success already relies on: in the unit, the bundle's real path sits inside the image's own installation.)

Why not road 2: it violates T20c's single-mount stance for exactly one harness, and adds a component to the dsh condition's composite fingerprint.

## Verification

Docs-only change (README.md + README.en.md contract paragraphs, config-table cross-reference). `pnpm --filter @khorsheed/dsh-local-agent-dsh build` + `test` green on the same branch. The mechanism itself is the eval team's already-measured road 3: a host-side same-named symlink plus the image's real installation at the pinned path resolved in both filesystems, and the dsh container round settled `completed` with `observedModel` read back from the session log.

## Alternatives considered

**Road 1: copy bundle + closure into the scoped home, relative link.** Rejected, see Decision — dual `@deepseek-ai` instances break service-key/class identity silently; family-only copies fail Node resolution. This is now written into the README so the next agent does not have to re-derive it.

**Road 1b: copy family packages, redirect their `@deepseek-ai` imports via shims or `NODE_PATH`.** Rejected: shims that re-export from an absolute path reintroduce the per-runtime path problem one level down, and `NODE_PATH` is ignored by ESM `import` anyway.

**Road 2: a second mount inside the unit.** Rejected: breaks T20c's "one mount" stance; only dsh would need it.

**Per-runtime symlink writes at boot.** Rejected: the directory is shared and writes race — host readiness re-probing between container rounds is exactly the interleaving the report hit. Whatever the shared directory holds must be valid in both filesystems at all times.

## Consequences

- The pin is a caller-side, machine-level precondition: every eval machine/image pair that bind-mounts a shared scoped home must agree on the path (document it in the eval env/README). This package ships no code for it.
- `headlessBundleDir` re-provisioning is idempotent-under-pin: readiness checks can no longer poison a container-bound profile.
- If a future host line resolves profile patch rows through multiple anchors (profile + installation fallback), the symlink could be dropped entirely and the pin retired with it — worth re-checking after each official loader release.
