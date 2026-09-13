# Agent Note: the pad's writes carry the calling session's fence

Status: implemented

## Problem

Clicking 新建 in the canvas answered 「这个位置不可写」. The three write paths in
`CanvasService` handed `ctx.fs.writeText` only `(target, content, expected)` —
no look at the mounted backend's sandbox. `SandboxedFileSystem.checkedTarget`
then resolved the policy with no session, which is the deployment default: the
`workspace-write` fallback root of the base bundle, i.e. **`process.cwd()` of
the host process** (`DSH_PERMISSION_MODE ?? 'workspace-write'`). The pad lives
in a session workspace; the host process was started from somewhere else
entirely, so every mutation was denied — while every read passed through
unfenced, which is why the list rendered 「还没有灵感」 and only the write
failed.

The capability fact is `ctx.fs.sandboxMode`: `undefined` on the bare local
backend, the deployment default mode on a fencing one. `ctx.sandboxPolicy` is
the only home of per-session resolution; the harness resolves it per call
everywhere a session exists (`tool-fs` through its sandbox controller,
`tool-bash`, `tool-pwsh`, `terminal-bash`) and passes the result as
`writeText`'s fifth argument.

## Decision

**A pad mutation is fenced by the session that started the gesture.**

- The three mutating Remote methods take the calling `agent` first
  (`@Remote('create')`, `@Remote('write')`, `@Remote('setArchived')`). The
  browser half passes the tab's `sessionId`; the generated client type spells
  that first parameter `agentId: SessionId`. This is the wire's existing
  lookup convention, not a new one — the datasets tab uses the same shape.
- `CanvasService.create/write/setArchived` now **require** a `session`, resolve
  `ctx.sandboxPolicy.resolve({ session })` once per call and stamp the result on
  the item write *and* on the `.index.json` write. `list`/`read` keep their old
  signatures: a fence is a write fence, and a pad must stay browsable for a
  session that is only being read.
- The policy home is captured in the constructor only when
  `ctx.fs.sandboxMode !== undefined`, so the unconfining local backend (the unit
  tests, a bare `dsh-fs-local` deployment) passes no policy at all and behaves
  exactly as before.
- Fail-closed: a session whose own workspace root does not contain the pad is
  denied, and a `read-only` session is denied — the existing `error.denied`
  copy (`这个位置不可写`) is what that refusal reads as, and it is now accurate.
- A composition that mounts the fencing backend without the policy home
  degrades silently rather than failing to load: the write then carries no
  policy and the backend's own fallback decides (still a denial, never an
  unguarded write).

## Verification

- `packages/canvas/tests/service.spec.ts`: the fake now mirrors
  `dsh-fs-sandbox`'s fence — a confining fake denies anything outside the
  caller's resolved root, and falls back to a host-cwd root when a call carries
  no policy. Deleting the stamp therefore fails the suite instead of silently
  regressing to the fallback root. Four cases: the body **and** index write
  carry the session root, the edit and archive write never touch the fallback,
  a foreign session is denied, and an unconfining backend carries no policy.
- `packages/canvas/tests/remote.spec.ts` (new): the three mutating methods
  forward `agent.session` into the store; the two reads need no agent.

## Alternatives considered

**Stamp the deployment default mode with the request's own directory as the
root** (`{ mode: ctx.fs.sandboxMode, workspaceRoot: dir }`). No new peer
dependencies, no wire change, and it would have fixed the reported case, because
the deployment default *is* `workspace-write`. It loses on one point: the mode
would come from the deployment, not from the caller. A session the operator
switched to `read-only` (or escalated to `danger-full-access`) would be fenced
by the deployment default instead of by its own decision, and the harness
resolves this policy per session everywhere else — a human-driven UI write has
no reason to be the exception.

**Let the browser send the mode** (`{ mode, workspaceRoot }` from the client).
The client does not own the fence; the mode must be resolved host-side from the
session, and any wire-supplied mode is a bypass waiting to happen.

**Throw when the filesystem confines but no policy home is mounted**, as
`FsSandboxController` does for tool-fs. Rejected: the repo rule is degrade, not
explode, and a plugin that throws on a missing capability takes the whole boot
down. The backend's fallback keeps this degradation fail-closed.

**Put the `agent` parameter on `list`/`read` too, for a uniform wire.** Reads
are unfenced, and the tab must still render a pad for a session that has no live
agent (an old, archived session). A parameter that only ever gets dropped is a
worse contract than an asymmetric one with a reason.

## Consequences

The pad is usable again in the deployment that reported the bug: writes land in
the session's own workspace, and the fence moves with the session rather than
with the host process's directory.

The wire contract changed: every mutating method of `remote.canvas` now takes
the session first. This package is the only consumer, and the browser half is
the only client, so nothing else needed migrating.

Three official packages joined the peer surface —
`@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-sandbox`,
`@deepseek-ai/dsh-sandbox-policy` (type-only, peer + dev, with the workspace
`overrides`/`minimumReleaseAgeExclude` entries). That is the price of resolving
the policy against the real host service instead of reimplementing it.

A `read-only` session still cannot use the pad at all. That is the honest
reading of the mode rather than an oversight, but it does mean the feature is
unavailable in a deployment configured that way — the refusal says so.
