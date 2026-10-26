# Agent Note: Learning suite drops the canvas

Status: implemented

## Problem

On 2026-10-19 the canvas joined `@khorsheed/dsh-learning-suite` (a `canvas` root row plus the `canvas-agent` grant on the `preset-dsh-learning` row), so a learner could write what they read as canvas cards. For the 2026-10-26 release wave the user held back canvas, canvas-novel, datasets, eval and lab — too many open problems. A suite cannot publish while it npm-depends on an unpublished member, and the learning suite is the one mode pack among the affected ones that still ships.

## Decision

The learning suite carries four members: library, reader, transcribe, capture. The `canvas` root row, the `canvas-agent` preset grant, the npm dependency, `dsh.bundle.members` / `dsh.references`, `FAMILY_MEMBERS`, the locale descriptions and both READMEs (member table, canvas feature section, summary line, example prompt) all drop it. The version stays 0.1.0 (never published); the CHANGELOG records the removal.

Nothing else depends on the canvas being there: the library has no code edge to it, and the reader's 「同步到画布」 button hides itself when the canvas service is absent (`packages/reader/src/client/contract.ts`). The reader README keeps that button only as a clause conditional on the canvas being installed.

The writing and eval suites, which carry the held-back packages, are not shipping either; shipped READMEs stop listing them under 「其他套件」.

## Alternatives considered

**Ship the canvas with the learning suite anyway.** Rejected by the user: the canvas has open problems this wave, and a suite member is installed by every learner.

**Hold the learning suite back too.** Rejected: the canvas was an add-on to the learning loop (library + reader), and nothing in that loop breaks without it.

**Keep the `canvas-agent` grant so a separately installed canvas lights up in learning sessions.** Rejected for now: the grant row would make the suite reference an unpublished package. Re-adding the row and the member is the path back once the canvas ships.

## Consequences

Learners lose the "write it as a card" step inside learning mode until the canvas ships; the reader's sync-to-canvas button stays hidden for them. In exchange the suite publishes on its own, with no dangling dependency. Re-adding the canvas is a symmetric edit: the root row, the grant, the dependency, the member lists, the README section.
