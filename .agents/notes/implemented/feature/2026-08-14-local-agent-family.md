# Agent Note: Local code-agent harness family

Status: implemented

English | [中文](2026-08-14-local-agent-family.zh.md)

## Problem

A dsh agent could not delegate work to locally-installed coding-agent CLIs (Kimi Code, Codex, Claude Code), and could not see the sessions its delegations created. Wiring each CLI directly into the core duplicated the delegation seam, and pointing a child at the user's native home (Kimi Code's `~/.kimi-code`) would let an agent read and write the user's personal sessions and credentials.

## Decision

The family is three packages plus per-harness bundles, with a strict seam boundary:

- `@deepseek-ai/dsh-local-agent` (`packages/local-agent/local-agent/`) owns harness identity and lifecycle only: the `ctx.localAgent` registry, one 0700 scoped home per harness under the shared homes root, the `/<harness> login|sessions` command family, and the startup invariant that cross-checks each harness's `delegationProvider` against the mounted subagent providers. Delegation stays OUT of this seam.
- Each harness bundle (first: `@deepseek-ai/dsh-local-agent-kimi` in `packages/bundle/local-agent-kimi/`) registers one harness (scoped-home env var, device-code login invocation, records adapter) into the core and mounts its own subagent-provider row into the existing `subagent` capability (subagent-acp for a CLI that speaks ACP over stdio), reading the scoped home through `localAgent.homeDir(name)`. Two registrations, two seams, one cross-checked contract.
- `@deepseek-ai/dsh-client-ui-local-agent` is the shared browser half: one session-header dropdown per configured harness, pulling the `/<harness> sessions` listing through the existing commands Remote — no core RPC additions.

Isolation is directory-based: every child process runs with the harness's env variable pointing into its scoped home, so credentials and sessions never touch the user's native installation. Login is device-code only; the URL surfaces in the command reply while the CLI polls in the background. The session records a delegation creates are listed from the scoped home (`session_index.jsonl` for Kimi), so "the sessions this agent can see" equals "the sessions in its own directory".

The harness shape records only the real per-installation differences (`homeEnvVar`, `login`, `records`, optional `delegationProvider`) — induced from the Kimi sample and validated by the Codex sample ([2026-08-16-local-agent-codex-harness.md](./2026-08-16-local-agent-codex-harness.md)), which added the `login.capture` field for stdout-printed login prompts; Claude Code shipped as the third sample ([2026-08-16-local-agent-claude-code-harness.md](./2026-08-16-local-agent-claude-code-harness.md)).

## Alternatives considered

- One combined package carrying both the node glue and the browser half, like `dsh-session-log-export`. Rejected: the glue needs `node:child_process` and `node:fs`, which the browser-safe client face cannot compile; a single package with two compilation faces is the sanctioned exception of `api/remotes` only.
- A delegation field on the harness with the core registering the subagent provider itself. Rejected: delegation belongs to the existing `subagent` seam; the harness bundle mounts its own provider row and the startup invariant cross-checks the pairing, so a record naming an unmounted provider fails loud without a second registration path.
- Capturing the login flow through a terminal session. Rejected for now: the web GUI has no interactive terminal surface, so the device-code URL is surfaced in the command reply while the CLI polls in the background; a terminal-backed login stays possible behind the same harness `login` contract.

## Consequences

> 2026-08: the delegation tool row moved from per-preset variants to the profile root (see [2026-08-15-profile-root-delegation-tools.md](./2026-08-15-profile-root-delegation-tools.md)); the seam and isolation decisions below still stand.

The user's native harness installations stay untouched: every child process runs against its scoped home. A harness is two registrations (identity into `ctx.localAgent`, delegation into `subagents`) whose pairing is invariant-checked, so a typo in either fails loud at load. The browser gains the records dropdown with zero core RPC additions. The harness shape is induced from the Kimi sample; Codex shipped as the second sample ([2026-08-16-local-agent-codex-harness.md](./2026-08-16-local-agent-codex-harness.md)) before the contract freezes.

## Verification

- Unit tests cover the registry lifecycle, login branches (prompt capture, spawn failure, timeout, pending guard), records parsing, and the delegation cross-check invariant.
- The Loader composition e2e boots the family plus the kimi harness with `PATH: ''` and asserts the provider, the tool, the registry, and zero spawned processes.
- oxlint, `verify-cordis-config`, typecheck, and doc-sync gates (catalog regeneration, translation pairing, type equivalence) pass for this change's surface.
