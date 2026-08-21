# @khorsheed/dsh-context-guard

English | [中文](README.zh.md)

A context-window compaction reminder for the dsh web GUI: once the **context occupancy** — the same number the composer's context ring shows — crosses a configured share of the model's context window, a compact button appears in the composer's tool row, and clicking it runs the official `/compact` command. No new RPC, no edits to core packages; removing the plugin removes every surface it adds.

<img src="docs/screenshots/context-guard-button.png" width="480" alt="the compact button appears in the composer once context occupancy crosses the configured ratio">
<img src="docs/screenshots/context-guard-settings.png" width="480" alt="the reminder-ratio setting in Settings → Plugins">

## Features

- **Compact button in the composer** — one `conversation.input.right` entry; renders nothing below the threshold, then appears automatically in the amber warning tint.
- **Same number as the context ring** — driven by the official `contextPressure` session projection, so the button and the ring never disagree.
- **Runs the official `/compact`** — through the host command channel, so idle-gating, the compaction lock, and the flow-node presentation stay host-owned.
- **One live tunable** — the occupancy threshold, editable in the GUI (Settings → Plugins → "压缩提醒时机 / Compaction reminder timing") with no restart.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-context-guard
```

Then restart the web instance. Uninstall removes every surface the plugin adds:

```sh
dsh plugin --profile web remove @khorsheed/dsh-context-guard
```

## Config

One tunable, editable in the GUI (Settings → Plugins → "压缩提醒时机 / Compaction reminder timing") and live — the button reacts to a saved value with no restart. The YAML composition entry below is the settings section's base layer; values the card does not override come from it.

| Key | Default | Meaning |
|---|---|---|
| `thresholdRatio` | `0.8` | Context occupancy fraction at which the compact button appears (clamped to (0, 1]). Lower it to be reminded earlier — the provider rejection wall sits below 100% occupancy because the request reserves output tokens (see *How it works*). |

Example composition (becomes the card's base layer):

```yaml
plugins:
  context-guard:
    thresholdRatio: 0.65
```

**This field tunes ONLY when the button appears.** The official compaction engine (compaction-basic) reads its own `thresholdRatio` / `auto` configuration and never touches this section — real compaction timing is not affected.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.1`): ✅ full — built and tested against the rc.8 type surface. This build REQUIRES rc.8: the `commands/execute` Remote gained a required `images` argument (rc.6/rc.7 hosts would receive shifted arguments) — stay on the previous build there. — also verified on 0.1.1-rc.1 (additive audit, 2026-08-21)
- source line (deepseek-harness master): ✅

## Known Limitations

- **The button is a reminder, not a guarantee.** Between "button appears" and "click", the context may keep growing; the host's `/compact` may report `busy` while the agent is running, and the compaction summary is subject to the same window fit as any request.
- **The output cap is not exposed in the UI.** The rejection wall depends on the model's output budget (`window − maxTokens`), which is a model property, not a user preference; the README carries the math and the "lower the ratio" guidance instead of a second confusing knob.
- **No auto-compaction.** The plugin only surfaces the manual action; the official 80% auto-compaction keeps running unchanged, and a compacted-away guard button disappears as soon as the projection reflects the shrunken surface.

## How it works

<details>
<summary>Why it exists and internals (click to expand)</summary>

### Reminding you before the wall the meter does not show

The official compaction-basic engine auto-compacts at `agent/pre-step` once the token-meter estimate crosses 80% of the context window. Two properties of that picture leave requests that can fail **before** the meter shows 80%:

1. **The rejection wall sits below 100% occupancy.** A provider rejects a request when `prompt + max_tokens > context_length` — the request reserves output tokens. With the deepseek adapter's defaults (window 1,000,000, output cap 256,000), the wall is at ~74.4% occupancy, far below both 100% and the official 80% compaction point. A CJK-heavy or schema-heavy session makes it worse: the estimator "systematically underprices CJK text and JSON schemas", so the provider-side count is higher than the ring shows.
2. **The official auto-compaction only runs between steps.** On an idle session nothing signals that the next send will fail, and during a long tool-calling turn the output keeps accumulating.

The guard is a reminder on top of the ring: at the default ratio (0.8) it appears exactly when the official engine would compact anyway; **lower the ratio (e.g. 0.6–0.7) to be reminded earlier** — while the summarization call of a manual `/compact` still fits comfortably.

### Mechanics

- **Seat**: `conversation.input.right` (the composer's tool row, before the send button). Renders nothing until the threshold is crossed, then appears automatically in the amber warning tint.
- **Data**: the official `contextPressure` session projection — `projectedTokens` (the provider-reported prompt sample carried forward over the surface's signed movement since, so a compaction shows immediately; the bare sample is the fallback for logs whose projection predates that field) and `contextWindow`.
- **Formula**: `projectedTokens / contextWindow >= thresholdRatio` → the button appears. This is the **same occupancy the composer's context ring shows** — one number, no confusion.
- **Action**: the official `/compact` command channel (`remote.commands.execute` → host `ctx.commands` → `ctx.compaction.compactNow`), so the host owns idle-gating, the compaction lock, and the flow-node presentation.

### Model experience

Nothing changes for the model. The button is composer chrome; clicking it runs the same `/compact` the user could type, and the session log sees a normal command lifecycle (and any compaction transaction) exactly as if it had been typed.

- **Token effect**: none from the plugin itself; the compact it triggers replaces the shadowed span with a checkpoint exactly as a manual `/compact` does.
- **KV cache effect**: none.

The `/client` exports are the plugin body (`apply`/`inject`) and the `CompactGuardButtonProps` / `ContextGuardSettingsCardProps` types.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/context-guard`). Issues and contributions welcome there.
