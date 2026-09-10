# Agent Note: Deployment checkout serves live client assets — pin it, audit elsewhere

Status: implemented

## Problem

On 2026-09-10 the deployment checkout (`~/code/deepseek-harness`) was pulled from the pinned `dsh-v0.1.2-rc.1` to master (7 commits past `dsh-v0.1.5-rc.1`) and rebuilt so an agent could audit the 0.1.5 source. The running 3080 server process kept its rc.1 code in memory and looked healthy — but the web client bundle is served **from the checkout on disk, per browser request**. Every browser that loaded 3080 after the 12:23 rebuild received the 0.1.5 client, which booted against the rc.1 server and failed: 32 official client plugins stayed `pending` on services the rc.1 wire does not provide (`sessions`, `fileUpload`, `uiWorkspace`, …). Prod was down for the browser half with zero process restarts, and the watchdog's canary had no chance to catch it because the canary had already settled at 01:10, before the rebuild.

The checkout had been treated as boot-time state ("a rebuild can't reach a running instance"). The incident proved it is **live-served state**: anything that rewrites `lib/` or the recorded client artifacts rewrites what prod serves, immediately, with no gate in between.

## Decision

- **The deployment checkout stays pinned to the tag prod actually runs** (`dsh-v0.1.2-rc.1` as of this note). It is never used as a development, audit, or type-resolution workspace. Re-pinning happens only inside a deployment window: fetch tags → checkout the target tag → `pnpm run clean` → `pnpm install && pnpm run build` → build+test green so the ankh-guard credential (bound to git HEAD) passes → `pnpm deploy:3080` wave → gated restart records the new proven deployment. The `clean` step is mandatory: `git reset` does not remove gitignored `lib/` output, and stale artifacts from a newer line break the older line's build (the rc.1 rebuild died on leftover 0.1.5 `ui-dockkit` output until `clean` swept it).
- **Source audits and 0.1.5-line work use dedicated checkouts.** `~/code/deepseek-harness-0.1.5-alpha` is pinned to `dsh-v0.1.5-rc.1` with install+build done; the pre-research worktree `~/code/dsh-plugins-wt-pre-0.1.5` points its `DSH_HARNESS` there. Any future host line gets its own checkout on demand — disk is cheap, prod incidents are not.
- **A rebuild of the deployment checkout is a prod-affecting action**, treated with the same care as a restart: announced, done on the pinned tag, and followed by a browser check of 3080.
- The watchdog's existing guarantees are the backstop, not the plan: the HEAD-bound restart credential blocks booting an unproven HEAD, and repeated boot failure can roll the checkout back to the proven commit — which is exactly why uncommitted state in the guarded checkout is considered disposable.

## Alternatives considered

- **Restart prod onto the new host line immediately when the checkout moves** — rejected: the plugin fleet was not adapted to 0.1.5 (SurfaceOp / `assistant/chunk` / format V3), and V3 session logs are a no-rollback point. A deliberate upgrade wave is the only acceptable path across that line.
- **Serve client assets from an immutable directory outside the checkout** — the right long-term shape, but it is an upstream host change; it goes through the upstream-change pipeline, not a local fork. Until then, discipline plus dedicated checkouts covers the gap.
- **Pure social convention ("just don't touch it")** — failed the same morning it was needed: the auditing agent had no ready 0.1.5 checkout, so the deployment one was the path of least resistance. The decision therefore includes keeping a built, pinned per-line checkout available so the rule is easier to follow than to break.

## Consequences

- Cost: one extra built checkout per host line under audit (~a few GB each), and host-line moves now carry an explicit re-pin ceremony instead of an ad-hoc reset.
- Bought: rebuilding any non-deployment checkout can no longer silently rewrite what 3080 serves; the watchdog's rollback can never destroy in-flight dev work, because there is none in the checkout it guards.
- The incident diagnosis is preserved in `docs/ops.md`-adjacent practice: "3080 works in `curl` but the browser shows pending plugins" now means "check the checkout's served assets match the running server line" before anything else.
