# Agent Note: headless bundle patch — `!!js` is scalar-only, and patch edits need boot verification

Status: implemented

English | [中文](2026-08-20-headless-patch-scalar-js-guard.zh.md)

## Problem

The member-bridge row added to the headless bundle patch (be0b300, member channel M3) shipped `args: !!js […]` — a `!!js` tag on a flow sequence. The loader's entry-list dialect defines `!!js` as a **scalar-only** js-yaml type (`vendor/include/src/index.ts` in the harness), so the whole profile failed at boot on the parse, before any plugin code ran. The change had passed package tests and review but was never boot-verified. Two separate anti-recurrence gaps: no in-repo check pins the patch dialect, and the headless bundle's mount discipline (sub-profile only) lived only in a patch-file comment.

## Decision

- `packages/local-agent-dsh-headless/tests/patch.spec.ts` parses `cordis.patch.yml` with js-yaml under the same scalar-only `!!js` type definition the harness include uses, so a mistagged collection fails in `pnpm test` instead of at profile boot; a second case pins the member-bridge row's shape (args/env values as tagged scalar expressions, `failOnStartupError: false`). js-yaml is a devDependency.
- The headless README (both languages) gains a **Mounting discipline** section: the bundle must never be added to an interactive profile's `bundles` (its persona/hmr/tools/code-runtime rows are sub-profile-only and collide or leak there); the sub-profile is auto-provisioned by the parent provider (`provisionDshSubProfile`), so nothing needs manual mounting anywhere; patch edits must be boot-verified (`dsh preflight` on a composing profile or one real sub-dsh launch).

## Alternatives considered

- **String-matching the patch (like `local-agent/tests/patch.spec.ts`)** — rejected for the guard: substring assertions cannot see tag/kind misuse; parsing with the real dialect rule can.
- **A shared repo-level patch linter** — deferred: one package's incident does not justify a cross-repo gate yet; if a second package hits the class, promote `patch.spec.ts`'s schema check into `scripts/`.

## Consequences

- The bug class (non-scalar `!!js`) now fails fast in tests; the boot-verification requirement and the no-interactive-profile rule are documented where a future editor will read them.
- The boot-verification gap itself is process, not code: package tests cannot prove a profile boots. Real-profile launches stay the authoritative gate for patch edits.
