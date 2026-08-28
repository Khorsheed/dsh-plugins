# Agent Note: worktrees model-facing tool (list/switch/create/remove) and per-session follow

Status: implemented

English | [中文](2026-08-25-worktrees-model-tool.zh.md)

## Problem

The worktrees plugin showed only the repository of a session's static `header.cwd`, so a session could not work across several git worktrees without opening a new session per worktree. There was also no cleanup habit: worktrees accreted and were pruned by hand.

## Decision

Add a model-facing `worktrees` tool (in `src/tool.ts`, registered via `ctx.tools.register(defineTool(…))`) with four actions, plus a per-session active-worktree override in `WorktreesService`:

- `list` — enumerate the repo's worktrees (path, branch, isMain, dirty, stale), where `stale` means clean and its branch is merged into the base.
- `switch <path>` — set the session's active worktree so the badge/drawer follow it.
- `create <path> [-b <branch>]` — `git worktree add`, then switch to it, so the model can spin up a worktree without a new session/cwd.
- `remove <path>` (`confirm: true`) — gated delete: requires `confirm === true`, refuses the main worktree, refuses a dirty worktree; clears the active override when the removed worktree was the active one (so the view falls back to the session cwd = main).

The override is keyed by `agent.id` in memory. `WorktreesRemoteService.cwd(agent)` now returns `activeWorktreeOf(agent.id) ?? agent.session.header.cwd`, so the badge/drawer follow. The tool probes the tools registry via `ctx.get?.('tools')` (property access `ctx.tools` would need `inject: ['tools']`, which would pend the whole plugin on the tools bundle) and degrades to badge/drawer-only when tools is absent. `remove` is conversational-confirm (the tool description gates on confirmation; `ask_user_question` may not be present in a profile).

## Verification

`tests/service.spec.ts` gains four cases (list isMain, create sets an active override, switch repoints it, remove guards confirm/main/dirty and clears the override). 32 tests pass, `pnpm run build` green, `check:plugins` 0 findings. Confirmed on a preview instance (port 3096) that the plugin boots with the tool and the badge/drawer still mount.

## Alternatives considered

- **Upstream live-cwd feed.** Refused — bash workdirs are per-call and not a mutable session state; the harness has no "model's current worktree" to read, and this plugin is upstream-change-averse. The tool-driven override is the plugin-side equivalent.
- **`-z` NUL-path output** (used for path quoting elsewhere) — not relevant to the tool.
- **Hard `inject: ['tools']`** on the plugin. Simpler but would pend the whole plugin (badge/drawer) on the tools bundle; the probe degrades only the tool.

## Consequences

A session's badge/drawer follow whatever worktree the model last switched to, and default to main otherwise. The override is in-memory and per-session, reset on host restart (persistence deferred). Removing a worktree is always gated on user confirmation and never removes main or a dirty worktree.
