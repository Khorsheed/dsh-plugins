# Agent Note: Agent Note gates — format + classification ported from the harness and wired into the pre-commit hook

Status: implemented

English | [中文](2026-08-18-agent-note-gates.zh.md)

## Problem

`.agents/notes/README.md` promised gates that did not exist in this repo: "enforced by `pnpm run verify-agent-note-format`", "the classification gate rejects other folders", and "`verify-archived-agent-notes` enforces…" — the README was carried over from the harness, and nothing mechanically enforced the uniform format. With no backstop, two notes drifted into a zh-first legacy style: `implemented/feature/2026-08-16-local-agent-resume.md` and `implemented/feature/2026-08-17-local-agent-dsh-member.md` (Chinese title, `## 背景/采用方案/验证/风险与后续`, no `Status:` line); their `.zh.md` files were Chinese duplicates rather than translations, so even the i18n naming contract (`.md` = English side) was broken — a drift the pairing gate cannot see (it only compares blob hashes). A probe running the harness gates against this repo's tree confirmed the state: classification passes (30 notes), format flags exactly those two.

## Decision

- **Port three scripts from deepseek-harness verbatim** (only their location changes): `scripts/agent-note-tree.ts` (closed lifecycle/class sets + dated-filename walker), `scripts/verify-agent-note-format.ts` (header / `Status:` grammar / per-lifecycle section skeleton / alternatives mandate), `scripts/verify-agent-note-classification.ts` (tree structure + legacy `docs/rfc` ban). Zero runtime dependencies; tsx is already a dev dependency.
- **Wire into the pre-commit hook**: `verify-agent-note-classification` + `verify-agent-note-format` + `verify-translation-pairing` run whole-tree on every commit, next to the staged-set hygiene check. All pnpm invocations pass `--config.verify-deps-before-run=false` so a concurrent agent's in-flight `pnpm-lock.yaml` (a deps-status mismatch) cannot turn the gate itself into an interactive reinstall prompt — hit in practice on 2026-08-18 while committing.
- **Migrate the two drifting notes** to the uniform format: English `.md` (translated, restructured to Problem / Decision / Alternatives considered / Consequences / Testing plus bespoke sections), Chinese `.zh.md` mirroring section-for-section, i18n hashes re-recorded.
- **Deferred**: `verify-archived-agent-notes` and the archived manifest machinery — no `archived/` tree exists yet; port when the first archival happens.

## Alternatives considered

### Why not keep relying on the README plus social discipline?

That is exactly what produced the two drifters: the README described the uniform format in detail, yet zh-first notes were still written — because nothing failed. In a multi-agent repo, a mechanical whole-tree gate is the only thing that closes the loop.

### Why not a staged-set-only gate (like hygiene)?

The note gates' invariants are whole-tree properties (classification, format, and pairing are global), and the tree is small (30 notes, milliseconds per run). A staged-only gate would let a drift in an unrelated note slip through until someone else's commit trips over it.

### Why not adopt the harness's `doc-sync` / run-gates aggregate wholesale?

dsh-plugins has no CI and no run-gates; a single aggregate script adds indirection for no gain here. The hook is the enforcement point, and the three pnpm scripts remain individually callable.

### Why not grandfather the two legacy notes?

The grandfather comment is only valid for notes dated before 2026-07-05 (per the README); both notes are from 2026-08-16/17, so they must conform, not be exempted. Their `.zh.md` duplicates were also a naming-contract violation worth fixing while migrating.

## Consequences

- Every commit now runs the three whole-tree gates; a format/classification/pairing drift blocks the commit with a precise message, so notes stay uniform without meetings.
- The pre-commit hook now tolerates a dirty lockfile (`verify-deps-before-run=false`), fixing a shared-checkout fragility observed in practice.
- The two dense technical notes are now bilingual (English + Chinese) and cross-linked; the i18n naming contract (`.md` English, `.zh.md` Chinese) holds for the whole tree.
- Remaining dangling README references (`docs/i18n/README.md`, `docs/AGENTS.md` slop checklist, `archived/AGENTS.md`, the archive-policy note) are outside this change; the archive gate lands with the first archive.

## Testing

- `verify-agent-note-classification` / `verify-agent-note-format`: 30 notes, all conform (green after the migration).
- `verify-translation-pairing`: all 45 pairs in sync (2 re-recorded).
- `pnpm run test:scripts` with the new `scripts/agent-note-tree.spec.ts`: green.
- `pnpm check:hygiene` on every touched file: 0 findings.
