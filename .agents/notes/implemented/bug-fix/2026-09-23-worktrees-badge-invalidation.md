# Agent Note: The worktree badge now follows the pane (event-driven invalidation, no polling)

Status: implemented

## Problem

The session-header badge and the worktrees tab render the same `summary` RPC (`remote.summary(agent)` resolves `cwd(agent)` as the active-worktree override or the session cwd), yet they visibly disagreed: the pane showed the session's worktree while the header stayed on `main`, and the header's dirty counts lagged the repository by minutes. The cause was not two data sources — it was two refresh cadences. The tab has three triggers (`rev` on the refresh button, mode switch and navigation revision; the post-switch version bump; a fresh mount when the tab is opened); the badge had two (mount + the plugin's own version bump) and the client had no polling, focus or activity trigger anywhere (`grep -rn "setInterval\|visibilitychange\|addEventListener('focus'" packages/worktrees/src/client` was empty). Every actor that was not that tab was therefore invisible to a mounted badge:

- the model's own `worktrees_switch` / `worktrees_create` tool writes the host's `activeWorktrees` map directly (`src/tool.ts:87,92` → `src/service.ts:305`) and the browser receives nothing;
- another browser tab switching the worktree;
- any external process editing the working tree (the repo's concurrent agents), which the header only re-read on a remount.

Two structural facts made it worse. First, `activeWorktrees` is an in-memory host `Map` (`src/service.ts:296`), so every host restart — including every deploy — drops the pointer and both surfaces fall back to the session cwd. Second, `worktrees/tool.ts` and the client tab are separate actors with no invalidation channel between them.

## Decision

The badge now re-reads its summary on real events only, through three channels and no timer:

- **The plugin's own version.** Any tab-side refresh invalidates the header: a `rev` effect in the tab bumps the controller version (the redundant explicit bump in the switch handler is gone, because the `actions.refresh()` that follows ticks `rev`). The injected face hands out a fresh closure per render, so the effect holds it in a ref and does not depend on its identity.
- **The Host's forwarded session events.** At apply the plugin subscribes once — probed, never assumed, because an older carrier has no `$on` — to `api-session/status(sessionId, running)` and `api-session/activity(sessionId, updatedAt)`, the two entries of the official `api/remotes` allowlist that mean "this session's state moved", and fans them out to badge listeners filtered by session id. A turn boundary is exactly when the model's tools (including a worktree switch) have just run; a user message is when the session's activity advanced. Both are the official `api-session/*` events, so this needs no upstream change.
- **Window focus / visibility.** The badge re-reads when the window regains focus or becomes visible — the single path that catches a change made by nobody in this session, at one RPC per return.

A summary costs five to six git invocations (`worktree list`, two `rev-list --count`, `status --porcelain`, two numstat ranges), so a 15 s timer per visible session would be roughly 1500 git calls an hour; that ceiling is why polling is not the fallback of first resort.

## Why these two events are enough

The reported divergence came from a model-side worktree switch, and that always happens inside an agent turn — so it is followed by an `api-session/status` flip and the badge re-reads then. The lagging dirty counts came from concurrent agents editing files, which no event in this host can report (see below); those now catch up on focus/visibility or on the next turn, which is the honest bound rather than a promise the transport cannot keep.

## What stays out of reach

A plugin cannot forward an event of its own: the forwarding set is the official `@deepseek-ai/dsh-api-remotes` package's static array `API_REMOTE_FORWARDED_EVENTS` (`packages/api/remotes/src/remote-events.ts`), consumed by the host assembly's forwarding loop (`src/index.ts:50`). A profile-level patch on an official package is forbidden here, and nothing in-repo used `ctx.remote.$on` before this change for exactly that reason. So "another browser tab switched the worktree and my header should know instantly" and "watch the working tree with `fs.watch` and push every change" both wait on upstream — registered as seam S16 in `docs/upstream-seam-registry.md` with the suggested change (let plugins contribute to the forwarded set, or expose a generic plugin notification channel).

## Alternatives considered

**Poll the badge (15 s, or 60 s while visible).** Rejected as the default: each read is five to six git processes, and the two forwarded session events already cover both symptoms the user reported. A visible-only, tab-closed-only low-frequency poll remains the documented degradation path for a host without the forwarded events — not a default.

**Have the badge subscribe to a plugin-owned event (`$on('worktrees/changed')`).** Rejected for now: it needs the upstream change registered as S16. The session events deliver most of the value with zero upstream work, and the probe keeps the code honest about the rest.

**Persist the active-worktree override as part of this change.** Rejected: that is a different defect (the pointer dies with the host on every restart, so after a deploy both surfaces fall back to the session cwd) and it needs a persistence decision — session record versus a `$DSH_HOME` file. Deferred, not silently fixed.

**Let the badge read the tab's store directly.** Rejected: the badge and the tab body are separate slot registrations; reaching into another entry's store is not a sanctioned channel, while the controller's version subscription already is.

## Consequences

Bought: the header and the pane now agree within one turn boundary or one focused return; a model-side worktree switch surfaces without any polling; the badge's read cost is bounded by real events instead of a timer; and the missing channel is written down as an upstream need instead of living in a bug report.

Cost: three invalidation channels to reason about instead of one; one extra `summary` read per event (a switch therefore costs two — the tab's refresh and the badge's follow-up — which is the price of the header not lagging); the badge reads once per forwarded event, so a session that flips `running` often reads more often than a timer would have — bounded by real agent starts and stops rather than by wall-clock.

## Testing

`packages/worktrees` carries 81 tests. The badge spec (17) gained three invalidation cases: a forwarded event naming its session re-reads, an event for another session is ignored, and `focus` re-reads. The plugin spec asserts both forwarded events are subscribed at apply and released on fiber disposal, and that the fake carrier's subscriptions are empty afterwards (the probe's degraded path is what the pre-existing harness exercised before it learned `$on`). The tab spec asserts a worktree switch leaves the badge invalidated.

## Deferred

- The active-worktree override's persistence (host restart drops it).
- `fs.watch`-driven realtime dirty counts — blocked on S16 (a push channel) and on watcher governance (the repository root contains `node_modules`).
- Upstream S16 itself; on landing, the worktree change becomes a plugin-owned forwarded event and the session-event subscription becomes a fallback.

## Related

- `docs/upstream-seam-registry.md` S16 — the plugin-owned-event gap this design works around.
- `.agents/notes/implemented/architecture/2026-09-23-preview-kernel.md` — the same package's earlier change in this batch (one shared content pane for the file list and the worktree tab).
- `proposals/active/2026-08-23-worktree-governance.md` — the proposal that owns the worktrees plugin's git-facing capability.
