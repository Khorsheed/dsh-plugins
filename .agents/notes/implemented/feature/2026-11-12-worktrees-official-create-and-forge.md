# Agent Note: use the official worktree creator without shrinking Worktrees

Status: implemented

English | [中文](2026-11-12-worktrees-official-create-and-forge.zh.md)

## Problem

The official 0.2.2-rc.2 worktree service creates a new branch in its configured pool, records the creation in the Session, and updates the caller's working directory. The community Worktrees package also supports arbitrary paths, adopting existing checkouts, repository-wide file editing, dirty badges and guarded deletion. Replacing it wholesale would lose those responsibilities or duplicate creation records.

## Decision

Delegate to `ctx.worktrees.create` only when an Agent and a non-empty new branch name are present, the path is absolute, and it exactly matches the configured official pool plus that branch. The official `{ path, branch, baseCommit, repositoryRoot }` becomes part of the tool result and the existing per-session binding points at the canonical returned path. Legacy listing, switching, editing, dirty reporting and guarded removal are unchanged.

An official failure is surfaced, never followed by a second legacy create. Arbitrary paths, existing-worktree adoption, missing Agent context and hosts without the service retain the old implementation. No archive cleanup is enabled by this change; the existing deletion guards stay independent.

Forge is only a review destination. The page watches the public `sidebarRightTabs` registry through the existing slot-hooks mechanism and opens the official `forge-panel` when present. It creates no second pull-request binding and hides the entry when Forge is absent.

## Alternatives considered

**Move all creation to the official service.** Rejected: its pool/new-branch contract does not cover arbitrary paths or adopting an existing checkout.

**Route a failed official create through the legacy command.** Rejected: the official failure can leave created artifacts, so another create would duplicate work and obscure the error.

**Share PR state with Forge.** Rejected: this package has no official binding role. Opening the existing panel is the only integration.

## Consequences

A real official harness creates a branch and checkout, updates the official Session cwd and writes `plugin:worktree/created`; the existing binding and the returned baseline agree. Package tests cover metadata, the arbitrary-path fallback, no second create after failure and the optional Forge entry.

The package's 14 test files / 119 tests pass on rc.2. Production deployment and publication are separate decisions.

## Related

- [Host 0.2.2-rc.2 adaptation](../process/2026-11-12-host-022-rc2-adaptation.md)
- [Official-capability roadmap](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
