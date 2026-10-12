# Agent Note: 3080's preset roster frozen all day — the watchdog bequeaths NODE_PATH to instances, hijacking resolution onto the main checkout

Status: implemented

## Problem

On 2026-10-12, 3080's preset roster and plugin inventory stayed frozen on stale content (游戏开发模式 present, 剪辑模式 absent) through repeated deploys and restarts. Everything on disk was correct and current — the profile patch, the installed package contents, `--dump-config`, and probe instances booted from a byte-copy of the profile — yet the live process, asked over raw RPC from the user's browser, listed only 9 presets with the `preset-dsh-video` row missing from its tree.

## Root cause

The watchdog (dsh-watchdog.sh) had been launched from a tsx-wrapped shell; tsx pins `NODE_PATH` to the caller checkout's pnpm store (`<repo>/node_modules/.pnpm/.../node_modules`). The watchdog's `launch_instance` scrubbed only `WD_*`, so `NODE_PATH` was inherited by every instance generation. Node's `require.resolve` consults NODE_PATH: bundle resolution (`resolveBundleDir` via `createRequire(anchor).resolve.paths`) hit the **main checkout's workspace copy** of `@khorsheed/dsh-presets` (main-branch content: 4 rows, gamedev in, video out) in NODE_PATH before falling back to the profile. The 0.3.1 installed in the profile was never read, so the tree and the roster tracked the checkout instead of the deployment — immune to deploys and restarts alike.

Proof: same home, same binary, one boot with and one without that NODE_PATH — 9 presets (matching prod) versus 10 (剪辑模式 back). The controlled pair closed the case.

## Decision

All three launch paths now scrub `NODE_PATH` / `NODE_OPTIONS` alongside `WD_*` (every known vector of the same leak class): the watchdog's `launch_instance`, the guard CLI's bare-restart spawn, and the supervisor spawn (so the watchdog itself stays clean rather than re-forwarding through `guard_cmd` node children). The test extends the existing "WD_* never leaks into the instance" case with the same pattern (sentinel injection + instance env dump). ankh-guard bumps to 0.4.3 (npm already carries 0.4.2).

## Alternatives considered

- **Restart without scrubbing**: proven ineffective the same day — while the watchdog carries NODE_PATH, every generation it respawns relapses.
- **Disable the NODE_PATH fallback inside the harness's resolveBundleDir**: the more fundamental fix, but the harness is a track-don't-modify upstream; recorded as an upstream proposal direction (resolution anchors should be explicit, never silently added by an environment variable).
- **Blank `NODE_PATH=` inline in the launch command**: treats the symptom, not the class — every new shell wrapper (tsx, bun, the next tool) can inject a new variable; the scrub defends the class.

## Consequences

- Instances launched or respawned from any shell no longer inherit the caller's Node resolution variables; bundle resolution returns to the two explicit anchors (install anchor → profile).
- The 3080 instance, re-supervised from a clean environment, serves the full roster again (all 10 presets); presets 0.3.1 (剪辑模式 plus the restored 游戏开发模式) is thereby actually in effect.
- The day's other fix (branch syncing main to restore the gamedev row, see `2026-10-12-presets-branch-sync-gamedev`) remains necessary and correct: it repaired the tarball's missing content, this note repairs the resolution hijack; the two faults stacked to make the symptom look so strange.

## Testing

Controlled boots with and without NODE_PATH reproduced the root cause (roster 9 vs 10); after re-supervising from a clean environment, the live `agentPresets/list` RPC returns all 10 presets and the inventory shows dsh-presets v0.3.1 with five components. The extended self-restart-guard.spec.ts case passes with the package suite; full ankh-guard test results are on the commit record.
