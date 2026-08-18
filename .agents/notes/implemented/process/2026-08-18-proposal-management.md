# Agent Note: Capability proposal ledger (proposals/) with a pluggable-delivery done verdict

Status: implemented

English | [中文](2026-08-18-proposal-management.zh.md)

## Problem

dsh-plugins had no capability-intent layer. Agent Notes (`.agents/notes/`) record single decisions with a proposed → implemented → rejected lifecycle, but a *capability* spans packages, PRs, and notes, and nothing tracked whether an intended capability exists, in what form, and who owns it. The historical capability ledger lived outside this repo (the personal-proposals snapshot at dsh-salvage-2026-08-16), so the gap between "intended" and "shipped as a pluggable plugin" was invisible here — the user asked for a proposals directory inside this repo, with status tracking, prompt closure after implementation, and management style modeled on Agent Notes. A second constraint makes the ledger's verdict rule nontrivial: the standing goal is that **every capability ships as a user-pluggable plugin with zero changes to official code** — so "implemented in a patch stream" must not count as done.

## Decision

- **New top-level `proposals/` tree**, independent from `.agents/notes/`:

  ```
  proposals/
    README.md / README.en.md   management spec (Chinese primary, English mirror; same as root README convention)
    active/                    in-flight proposals: idea / planned / in-progress / blocked
    closed/                    done / closed (abandoned, superseded, absorbed upstream)
  ```

- **One proposal = one capability intent**, named `YYYY-MM-DD-<slug>.md` (Agent-Note naming convention). Status is path-encoded: `active/` vs `closed/`, mirroring how Agent Notes encode lifecycle in folders, so a status change forces the file move.
- **State machine**: `idea → planned → in-progress → verified → done`; `blocked` (reason required) as a side branch; any state can go `closed` (reason required). **A status change edits the header + moves the file + updates the README ledger table in the same commit.**
- **Done verdict bound to pluggable delivery**: `done` requires the capability to ship as a standalone plugin package (self-mounting `dsh.bundle`, removable via `dsh plugin remove`). A patch-dependent implementation may be `verified` at most, never `done`, and must state a de-patching path. Absorbed-upstream → `closed`.
- **Header keys are fixed and machine-readable** (`分类 / Classification`, `状态 / Status`, `最后更新 / Last updated`, `查重结果 / Duplicate check`, `官方依赖 / Official dependency`) so a future verification script can parse them, but **no gate ships now** — this is a lightweight convention layer.
- **Anti-stall**: `idea`/`planned` untouched 14+ days, or `verified` not turned `done` within 7 days → ⚠️ `stale` in the ledger; resolve with one of raise-priority / close-with-reason / keep-with-reason. Scan the ledger at the start of each working session.
- **Integration with Agent Notes**: implementing a proposal still requires an Agent Note for every non-trivial change (AGENTS.md unchanged); the proposal's optional `## Implementation log` section cross-registers notes / PRs / package names. Proposals do not replace per-package `issues/` or release planning. A `backlog.md` capability-gap pool was shipped with the initial commit and **removed on the user's request** (2026-08-18): most audited historical capabilities are not worth pursuing in this repo, so no in-repo capability list is kept and the historical archive stays in its original snapshot.

## Alternatives considered

### Why not put proposals under `.agents/proposals/`?

`.agents/` is the agent-workflow surface; proposals are read by people (maintainers, contributors) deciding what to build next, and the root-level `proposals/` makes the ledger discoverable the same way `packages/` and `docs/` are. The Agent-Note conventions (path-encoded lifecycle, dated slug naming) are borrowed regardless of location.

### Why not fold capability tracking into Agent Notes?

An Agent Note answers "why this change, what we gave up" for one decision; a capability spans many decisions and outlives any of them. Folding them in would either stretch a note's single-lifecycle model or duplicate the ledger inside notes. The two layers are kept deliberately separate, with the proposal's implementation log as the cross-link.

### Why not copy the 38 historical proposal files into this repo?

They are a frozen snapshot of a different (patch-stream, personal) context; copying would import stale detail and create a second authority that must be kept in sync. An audit summary was initially sedimented into a `backlog.md` pool, but the user judged most of those capabilities not worth pursuing in this repo, so the file was deleted and the archive is simply left in its original snapshot — proposals here start fresh.

### Why not ship a verification script / gate for proposal headers?

The Agent-Note gates exist because AGENTS.md promises mechanical enforcement and drift was observed; proposals have no such promise yet, and a gate adds maintenance cost for a young directory. The fixed header keys leave the door open for a later script without paying for it now.

## Consequences

- Capability intent now has a single in-repo entry point with an explicit done verdict that encodes the zero-official-changes goal: patch-dependent implementations cannot masquerade as done, which is exactly the discipline the user asked for ("close promptly after implementation").
- The historical personal-setup capabilities are **not** tracked here: the user decided most are not worth pursuing in this repo, so no capability-gap list is kept and the archived snapshot remains the only record.
- Proposals remain convention-only: no new scripts, no new gates, no pre-commit changes — the directory is pure documentation plus a ledger table maintained by the same move-the-file discipline Agent Notes use.
- Any agent working this repo should scan `proposals/README.md` and the ledger before starting work, same as scanning the notes tree.

## Testing

- `pnpm check:hygiene` on all new files: 0 findings (no absolute paths, no credential-shaped strings, no tooling/scratch state).
- `pnpm run verify-translation-pairing --write` re-recorded the Agent-Note pair; `verify-agent-note-format` / `verify-agent-note-classification` green for the whole tree.
