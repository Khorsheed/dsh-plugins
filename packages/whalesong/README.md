# 🐳 dsh-whalesong

> 任务跑着,鲸鱼喷水。Whale song while tasks run.

English | [中文](README.zh.md)

Whalesong is an optional status-ambience bundle for the dsh web GUI: while any session is running, the sidebar whale spouts water and the tab favicon animates; when a task finishes or blocks on you, it plays a short chime.
Pure browser-side behavior over the session list, with a tiny config-serving host half — zero patches to official files, zero model-visible effects, and no replacement of official UI slots.

## Install

One command, no checkout, no manual config:

```sh
dsh plugin --profile web add @khorsheed/dsh-whalesong
```

Then restart the web instance.
The bundle is additive: it mounts only its own entry row, so `dsh plugin --profile web remove @khorsheed/dsh-whalesong` restores the previous composition exactly.

## What it does

- **favicon waterline bubbles (primary indicator)**: while any session runs, the tab icon becomes the whale bobbing at a waterline with three rising bubbles (SVG frames, no canvas); when idle, the tab icon stays a **static whale colored to the page palette** (black on light pages, white on dark pages) instead of restoring the stock icon — the stock icon's `prefers-color-scheme` follows the OS and renders an invisible white whale on a light page with a dark system. Only a failed fetch of the stock artwork falls back to the previous icon; a transient failure retries on the next activation edge or theme switch.
- **sidebar droplets**: three DeepSeek-blue droplets rise from the sidebar whale's blowhole (DOM overlay anchored to the official logo; a fixed rail-corner fallback when no anchor exists).
- **chimes**: completion = three rising sine glides (380→520→700→990 Hz); blocked = the same 440→660 Hz rise twice (WebAudio synthesis, no audio assets). Under `prefers-reduced-motion` the animation hides and the chimes go silent.

## Config

The cordis plugin config lives in the profile patch layer (or a later `--patch` overlay) and hot-applies within one poll round-trip, no browser refresh:

```yaml
- id: whalesong
  config:
    enabled: true   # false = no overlay, no chimes, no session subscription
    volume: 1       # 0..1 loudness; gain = 0.1 × volume; 0 mutes without disabling
```

The host half holds the resolved config and serves it over the plugin-owned route `GET /whalesong/config` (the official settings RPC refuses external namespaces, so cordis Config + own route is the channel).
The browser half polls that route every 3 s and applies changes; a flaky route keeps the last known config.

## Architecture

```
src/index.ts            host half: Config + GET /whalesong/config route (mount anchor)
src/invariant.ts        package invariant companion (no runtime checks: no second authority exists)
src/client/index.ts     cordis client plugin: inject ['sessions'], ctx.effect owns lifecycle
src/client/config.ts    config sync: fetch + 3 s poll; no-fetch surfaces keep the default
src/client/controller.ts  runtime controller: idempotent enabled/disabled state machine + 2.5 s reconcile poll
src/client/status.ts    pure diff of session-list snapshots into whalesong events
src/client/favicon.ts   favicon animation: SVG frame data-URLs; the page-matched static whale stays when idle
src/client/whalesong-overlay.ts  fixed overlay anchored to the official sidebar logo
src/client/sound.ts     WebAudio oscillator chimes (autoplay-unlock on first gesture)
src/client/whalesong.module.css  droplet keyframes + on/off + reduced-motion rules
```

State semantics: `anyRunning` counts only the UI-listed session ids (addressed subagent rows can project a lingering `running` bit from the child catalog and once latched the overlay on), and a low-frequency reconcile poll re-diffs the snapshot so a lost notification still clears within one interval of the work ending.
The first frame after enable is the baseline: sessions already running show the whalesong but do not chime.

## Model Experience

None, as the plugin only renders browser-side status ambience from the session list and registers nothing model-facing.

#### KV Cache effect

None.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.8`): ✅ full — the rc.7→rc.8 API audit (2026-08-20) confirms every surface this plugin consumes (slots, core services, core events, cordis 4.x, schemastery) is unchanged or additive; no source change was needed.
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- Chimes arriving before the first user gesture (autoplay policy) are dropped, never queued.
- No per-session tone differentiation and no settings UI beyond the plugin config.
- The official sidebar logo itself is never replaced (single slot, zero-patch overlay only); on sidebars without the anchor ids the overlay falls back to a fixed rail-corner position.
- Hot-disabling on an already-open page (`entry.update({disabled})`) keeps the page's existing fiber until a refresh (hot-first semantics); the plugin's own dispose path is residue-free.
