# @khorsheed/dsh-context-guard

English | [中文](README.md)

A "compact now" button that shows up in the composer before your context runs out.

The longer a conversation runs, the fuller the context gets — and at the far end the provider starts rejecting requests outright. That wall arrives earlier than the 100% the context ring suggests, because every request also reserves room for the output. This plugin's job is simple: once occupancy crosses the ratio you set, an amber button appears in the composer's toolbar, and clicking it is the same as typing `/compact` yourself. It never compacts for you — it just reminds you while you still can.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/context-guard-button.png" width="640" alt="the compact button appears in the composer toolbar once context occupancy crosses the configured ratio">

## Features

- **Compact button in the composer** — invisible below the threshold, appears automatically above it.
- **Same number as the context ring** — driven by the official `contextPressure` projection, so button and ring never disagree.
- **Runs the official `/compact`** — idle-gating, the compaction lock, and presentation stay host-owned; a click behaves exactly like the typed command.
- **One live tunable** — the reminder threshold, editable in settings with no restart.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/context-guard-settings.png" width="640" alt="the trigger ratio is configurable in settings (0.01–1)">

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-context-guard
```

Restart the web instance after adding. Uninstalling removes every surface it adds:

```sh
dsh plugin --profile web remove @khorsheed/dsh-context-guard
```

## Config

One tunable, editable in the GUI and live with no restart — on 0.1.5 under Settings → Plugins ("压缩提醒时机 / Compaction reminder timing"); on 0.1.6-alpha.2+ in the bundle's own configuration section on its Plugins-page detail view.

| Key | Default | Meaning |
|---|---|---|
| `thresholdRatio` | `0.8` | Context occupancy fraction at which the button appears (clamped to (0, 1]). Lower it to be reminded earlier — the provider rejection wall sits below 100% occupancy (see *How it works*). |

```yaml
plugins:
  context-guard:
    thresholdRatio: 0.65
```

**This field tunes ONLY when the button appears** — real compaction timing stays owned by the official compaction engine's own `thresholdRatio` / `auto` config.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.2-rc.1`): ✅ full — baseline moved to the 0.1.2-rc.1 API surface (single-arm 0.1.2 API consumption; the 0.1.1-rc.2 runtime arm is retired), full build+test green; minHost moves up to 0.1.2-rc.1 — older hosts stay on the previous release line.
- 0.1.6-alpha.2 pre-release line (`@deepseek-ai/dsh@0.1.6-alpha.2`): ✅ full — the `settings.plugin.item` slot is removed in the ui-settings-plugins refactor; the settings card moves to `plugins.bundle.config` (keyed by package name, the Plugins page drawing the title chrome); the dual-inject probe keeps the 0.1.5 card working, minHost unchanged.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1)

**Version line mapping**: 0.2.0 and up support host `0.1.2-rc.1` and later; hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`).

## Known Limitations

- **Reminder, not guarantee** — context may grow between the button appearing and the click, and `/compact` can report `busy` while the agent runs.
- **No output-cap knob** — the rejection wall depends on `window − maxTokens`, a model property, not a user preference.
- **No auto-compaction** — the official 80% auto-compaction keeps running unchanged.

## How it works

<details>
<summary>Why it exists and internals (click to expand)</summary>

### Reminding you before the wall the meter does not show

The official compaction-basic engine auto-compacts at 80% of the context window, and only between steps. But providers reject a request when `prompt + max_tokens > context_length` — the request reserves output tokens, so the rejection wall sits below 100% occupancy. With the deepseek adapter's defaults (window 1,000,000, output cap 256,000) the wall is ~74.4%, below even the official 80% point; the estimator also underprices CJK text and JSON schemas, so the provider-side count runs higher than the ring shows. On an idle session nothing signals that the next send will fail.

At the default ratio (0.8) the button appears exactly when the official engine would compact anyway; **lower the ratio (e.g. 0.6–0.7) to be reminded earlier** — while a manual `/compact`'s summarization call still fits comfortably.

### Mechanics

- **Seat**: `conversation.input.right` (the composer's tool row, before the send button).
- **Data**: the official `contextPressure` session projection — `projectedTokens` and `contextWindow`, with a fallback to the bare provider sample on older logs.
- **Formula**: `projectedTokens / contextWindow >= thresholdRatio` — the same occupancy the context ring shows.
- **Action**: the official `/compact` channel (`remote.commands.execute` → `ctx.commands` → `ctx.compaction.compactNow`).

### Model experience

Nothing changes for the model: clicking the button runs the same `/compact` the user could type, with the same command lifecycle in the session log. The plugin itself has no token or KV-cache effect.

`/client` exports the plugin body (`apply`/`inject`) and the `CompactGuardButtonProps` / `ContextGuardSettingsCardProps` types.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/context-guard`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
