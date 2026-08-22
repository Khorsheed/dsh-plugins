# Agent Note: typert packages reconcile literal files entries with the whole-lib glob

Status: implemented

English | [中文](2026-08-21-typert-files-reconciliation.zh.md)

## Problem

`gen-typert` failed for every typert package with `TypertAnalysisError: … package files must include lib/typert.host.js` after e007ba3 switched package `files` fields to the whole `'lib'` directory (the tsdown hashed-chunk break made enumeration impossible). The harness generator validates the manifest with literal `files.includes('lib/typert.<face>.js')` / `.d.ts` checks, which a bare directory glob never satisfies — the canonical build for all five typert packages was broken repo-wide.

## Decision

Each of the five typert packages — message-tools, file-preview, datasets, mission, local-agent — keeps `'lib'` (for hashed chunks) AND lists the literal stable-name entries `lib/typert.host.js`, `lib/typert.host.d.ts`, `lib/typert.remote-client.js`, `lib/typert.remote-client.d.ts` in `files`. The literal entries duplicate paths the `'lib'` glob already covers; npm pack dedupes identical paths, so the redundancy is inert — the entries exist only to satisfy the generator contract. file-preview additionally carries `skills/**/*.md` (the 3d-artifact skill, see the [skill-registration note](../../implemented/feature/2026-08-21-3d-artifact-skill-registration.md)).

## Alternatives considered

- **Editing the harness generator to accept the directory glob**: rejected — we never modify upstream; the manifest-side fix is inert and satisfies the contract as written.
- **Skipping gen-typert for the skill change**: rejected — the canonical build must stay green; the fix is mechanical and additive.

## Consequences

- `gen-typert` passes again — verified: all five packages regenerated from the overlay in one batch.
- `files` fields carry redundant-looking entries; the convention is to regenerate the literal typert entries whenever the generator changes its validation.
