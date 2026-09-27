# @khorsheed/dsh-whalesong

English | [中文](README.md)

While tasks run, the whale spouts; when they wrap up, you get a chime.

A pure ambience plugin: you don't have to stare at the page to know whether the agent is still working. Whenever any session is running, the tab icon turns into an animated bubble-blowing whale and the sidebar whale spouts droplets too; when a task finishes — or the agent gets stuck waiting for you — a short chime plays. No patches to official files, nothing the model can see — install it and the page simply feels alive.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/whalesong1.png" width="640" alt="while tasks run: the sidebar whale spouts and the tab icon animates with bubbles">

## Features

- **Favicon waterline bubbles (primary indicator)** — the tab icon animates while anything runs and rests as a static, page-palette-matched whale when idle (the stock icon's OS-driven `prefers-color-scheme` can render an invisible white whale on light pages).
- **Sidebar droplets** — three DeepSeek-blue droplets rise from the sidebar whale's blowhole while work is in flight.
- **Chimes** — completion and blocked get distinct synthesized tones (no audio assets). Honors `prefers-reduced-motion`: animation hidden, chimes silent.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/whalesong2.png" width="640" alt="a chime when the run finishes, and the tab icon changes with it">

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-whalesong
```

Then restart the web instance. Uninstall restores the previous composition exactly:

```sh
dsh plugin --profile web remove @khorsheed/dsh-whalesong
```

## Config

Optional, hot-applied within one poll round-trip (no browser refresh), in the profile patch layer:

```yaml
- id: whalesong
  config:
    enabled: true   # false = no overlay, no chimes, no session subscription
    volume: 1       # 0..1 loudness; 0 mutes without disabling
```

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ full — baseline moved to the 0.1.2-rc.1 API surface, full build+test green; the blocked chime subscribes the ui-session Session status snapshot (the 0.1.5 `ctx.uiSession.pendingInteractions` face is adapted forward), and in an assembly without that service the blocked chime degrades off silently while completion chimes keep working. minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- 0.1.6-alpha.2 pre-release line (`@deepseek-ai/dsh@0.1.6-alpha.2`): ✅ full — the `SessionPendingInteractionSnapshot` face is removed in alpha.2; the blocked chime now reads the unified `ctx.uiSession.sessionStatus` (each entry's `pendingInteraction`); the probe + adapter keep the 0.1.5 line working, minHost unchanged.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1)

**Version line mapping**: 0.2.0 and up support host `0.1.2-rc.1` and later; hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`).

## Known Limitations

- Chimes arriving before the first user gesture (autoplay policy) are dropped, never queued.
- No per-session tone differentiation and no settings UI beyond the plugin config.
- The official sidebar logo is never replaced (zero-patch overlay only); without the anchor ids the overlay falls back to a fixed rail-corner position.
- Hot-disabling on an already-open page keeps the page's existing fiber until a refresh; the plugin's own dispose path is residue-free.

## How it works

<details>
<summary>Internals (click to expand)</summary>

Pure browser-side behavior over the session list, plus a tiny config-serving host half. The host holds the resolved config and serves it over the plugin-owned route `GET /whalesong/config` (the official settings RPC refuses external namespaces); the browser polls it every 3 s and applies changes, keeping the last known config on a flaky route.

```
src/index.ts            host half: Config + GET /whalesong/config route (mount anchor)
src/invariant.ts        package invariant companion
src/client/index.ts     cordis client plugin: inject ['sessions'], ctx.effect owns lifecycle
src/client/config.ts    config sync: fetch + 3 s poll
src/client/controller.ts  runtime controller: idempotent enabled/disabled state machine + 2.5 s reconcile poll
src/client/status.ts    pure diff of session-list snapshots into whalesong events
src/client/favicon.ts   favicon animation: SVG frame data-URLs
src/client/whalesong-overlay.ts  fixed overlay anchored to the official sidebar logo
src/client/sound.ts     WebAudio oscillator chimes (autoplay-unlock on first gesture)
src/client/whalesong.module.css  droplet keyframes + on/off + reduced-motion rules
```

State semantics: `anyRunning` counts only UI-listed session ids, and a low-frequency reconcile poll re-diffs the snapshot so a lost notification still clears within one interval of the work ending. The first frame after enable is the baseline: sessions already running show the whalesong but do not chime.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/whalesong`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
