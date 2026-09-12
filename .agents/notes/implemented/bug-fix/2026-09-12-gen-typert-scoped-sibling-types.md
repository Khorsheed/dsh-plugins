# Agent Note: scoped typert generation resolves unselected siblings from built types

Status: implemented

English | [中文](2026-09-12-gen-typert-scoped-sibling-types.zh.md)

## Problem

`GEN_TYPERT_ONLY` scoped builds copy only the selected packages' sources into the overlay and map only their `@khorsheed/*` paths — by design (605379c: a sibling's in-flight source breakage must not fail an unrelated package's build). But a selected package may hold a TYPE-only import of a family sibling — `packages/room/src/adapter.ts` reads the local-agent facade's types — and with the sibling unmapped and absent from the overlay, scoped generation failed with TS2307. A `deploy-3080 --package packages/room` (which scopes `GEN_TYPERT_ONLY` to exactly the deployed set) therefore could not build room unless local-agent happened to be deployed alongside.

## Decision

Unselected siblings resolve from their BUILT declarations, never their source: `copyTypertSiblingTypes` copies each unselected registered package's `lib/types` into the overlay, and `typertSiblingTypePaths` adds the matching `paths` entries (`./<dir>/lib/types/…`). Isolation is preserved — the sibling's source is still neither copied nor analyzed; only its already-built declaration surface is read. A sibling without a built `lib/types` is skipped, and an actual import of it fails with the plain TS2307, which then correctly reads as "build the sibling first".

## Verification

- `scripts/gen-typert.spec.ts`: the sibling paths map covers only unselected packages with a built `lib/types` (selected package and lib-less siblings absent), and the copy lands `lib/types` without `src`.
- `pnpm test:scripts`: 124 passed.
- Real scoped run from `packages/room`: `GEN_TYPERT_ONLY=…,@khorsheed/dsh-room tsx scripts/gen-typert.mts` — the exact deploy-time invocation that failed with TS2307 before — now generates room's artifacts.

## Alternatives considered

**Copy all registered sources in scoped mode too (map every sibling to src).** Rejected: that is exactly the coupling 605379c removed — one sibling's broken WIP would again fail every scoped build.

**Absolute `paths` entries into the real repo's `lib/types`.** Rejected: keeps the overlay self-contained and overlay-relative, the same style as every other entry; absolute targets depend on tsconfig path-resolution subtleties (baseUrl interaction) for no gain.

**Deploy-time workaround: always add family siblings to the deploy list.** Rejected as the only answer (it hides the flaw and bloats every deploy); worth knowing as a fallback, but the tooling should do what the scoping comment already promises.

## Consequences

- Deploying room (or any package with a type-only family import) alone works again; the acceptance gate no longer depends on which siblings happen to ride along.
- The sibling's declarations must be BUILT for resolution to succeed — same requirement the package's own `tsc -b` already has, so no new burden.
