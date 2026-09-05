# Agent Note: dsh-eval offline verbs — the dataseek contract, validator, and hashing kernel

Status: implemented

## Problem

web-eval's I1 walked one cell by hand and left behind two contract examples — a condition and a plan (dataset repo `i1-walk` branch) — that nothing could check. The orchestrator `@khorsheed/dsh-eval` did not exist, so contract drift (permission words, judge/expectedNs consistency, lock resolution) and condition identity ("these two cells differ in exactly one factor" must be provable) had no enforcement. The dataset-authoring protocol had no home for the eval contract either, so the schema shapes lived only in ad-hoc files in the dataset repo.

## Decision

`packages/eval` (`@khorsheed/dsh-eval`) ships the offline half of the orchestrator:

- The three contract schemas (`dataseek.condition/1`, `dataseek.plan/1`, `dataseek.verdict/1`) plus the `dataseek.condition-lock/1` record live in one module, `src/schema.ts`, and are published verbatim in the dataset-authoring protocol §6. Tests pin doc and code against drift, and the protocol's JSON examples double as validator fixtures.
- A hand-rolled JSON Schema subset validator mirrors `mission/src/schema.ts` keyword-for-keyword — duplicated, not imported, because community plugins never import sibling `@khorsheed/*` packages. Stage schemas outside the subset are an error, since mission's schema-check guard consumes the same files at run time.
- `validatePlan` checks plan schema and semantics (a present-but-empty judge is legal; an absent judge forbids `llm-draft` in `expectedNs`; the judge must not be a player; bounds), resolves condition IDs against `conditions/<id>.lock.json` (missing lock = "not ready" warning, never an error), validates referenced condition documents (the four nullable fields' `null` = "unresolved" warnings), and lints stage schemas.
- The condition hash is sha256 of the canonical JSON (keys sorted, no whitespace) with `notes` excluded — review commentary must not read as a new factor. The scoped-home hash covers only config-suffixed files under a deny list (auth/env files, token/key/credential/secret/password/auth names, the credentials/oauth/sessions/keys/secrets directories, symlinks, oversize files); content feeds the digest and never leaves it.
- Service face `ctx.eval` (`validatePlan` / `hashCondition` / `hashHome`) and the `dsh-eval` CLI (`validate`, `conditions hash`; exit 0/1/2 as lab, data on stdout, diagnostics on stderr). No config, no inject, no `@khorsheed/*` imports, no client half; the CLI builds the kernel directly, so scripts behave identically without the plugin mounted.

The I1 field decisions are encoded as stated: plan conditions carry IDs, never shas; locks resolve them; unresolved ≠ invalid.

## Alternatives considered

- **ajv for validation.** Rejected: mission's guard already defines the subset for stage schemas; a second, fuller validator would let validate() accept schemas the guard refuses. Zero dependencies keeps the two aligned by construction.
- **Import mission's validator.** Rejected: community plugins never import sibling `@khorsheed/*` packages (the independence checker enforces this). The duplication is pinned by mirroring the exact keyword set and stating the constraint in the module header.
- **Hash the condition document including `notes`.** Rejected: a comment edit would mint a new condition hash and manufacture phantom factor changes; `notes` is declared non-semantic instead.
- **Make missing locks and unresolved fields errors.** Rejected: validate is the planning-time reporter; blocking belongs to the pre-run readiness gate (I2), which needs the distinction between "malformed" (error) and "not resolved yet" (warning) to stay meaningful.
- **Schema-level enum for per-harness permissions only.** Considered a harness-conditional schema — impossible in the subset; instead the schema enum carries the union and the validator narrows per known harness, degrading to the union for unknown harness names.

## Consequences

- The I1 examples now validate with warnings only, and condition hashing is deterministic — the I1 acceptance criterion ("the plan passes validation and hashes twice the same") has a tool.
- The lock format exists but nothing writes it yet (provision is I4); until then every plan reports `LOCK_MISSING`, which is the honest state of the walk.
- Schema evolution is protocol-revision-driven: new condition/plan fields land as optional additions in a protocol rev, never as undeclared keys (`additionalProperties: false` throughout).
- run / readiness / generateTemplate / provision remain unimplemented; `ctx.eval` grows them in I2 without breaking the offline surface. The report verb has since landed with its own note: [eval-report-verb](2026-09-05-eval-report-verb.md). The dataset repo's manifest `output_schema` migration (referencing `schemas/<stage>.json` by name) is documented in the protocol but is dataset-side work.
