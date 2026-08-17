# @khorsheed/dsh-context-guard

English | [中文](README.zh.md)

Proactive context-window compaction guard for the dsh web GUI. The browser half contributes one `conversation.input.right` entry — a compact button inside the composer's tool row that appears automatically when the **next request's budget** crosses a configured share of the model's context window. Clicking it runs the official `/compact` command, so you compact early, while a compaction can still run. The guard needs no new RPC and no edits to core packages; composing this plugin out of cordis.yml removes every surface it adds. The `/client` exports are the plugin body (`apply`/`inject`) and the `CompactGuardButtonProps` / `ContextGuardSettingsCardProps` types.

## Why it exists: the failure the official auto-compaction leaves unannounced

The official compaction-basic engine compacts at `agent/pre-step` once the token-meter estimate crosses 80% of the context window. Two properties of that check leave a window where the provider rejects the main loop's requests with no in-UI warning:

1. **The check excludes the output budget.** A provider rejects a request when `prompt + max_tokens > context_length`. The official pressure check compares only the meter's context estimate against 80% of the window, so a request whose prompt sits below 80% but whose prompt + output budget exceeds the window fails with `CONTEXT_WINDOW_EXCEEDED`. The overflow recovery then compacts and retries — its summarization call reserves only its own small output cap, so the replay still fits and the retry succeeds — but the user pays a failed send first, and on an idle session nothing signals that the next send will fail. A long tool-calling turn widens this: each step's output and tool results are appended while the danger stays invisible in the estimate.
2. **The meter deliberately underprices.** The token-meter estimator "systematically underprices CJK text and JSON schemas", so a CJK-heavy or schema-heavy session can sit under the 80% estimate while the provider-side count is already past the point where `context + maxTokens` fits.

The guard surfaces the danger while the numbers are still inside the window: it adds the configured output budget (the main request's reservation) to the projected context and shows the button once the sum crosses the threshold — so you compact early, while the summarization call still fits.

## How it works

- **Seat**: `conversation.input.right` (the composer's tool row, before the send button). Renders nothing until the threshold is crossed, then appears automatically.
- **Data**: the official `contextPressure` session projection — `projectedTokens` (the provider-reported prompt sample carried forward over the surface's signed movement since, so a compaction shows immediately; the bare sample is the fallback for logs whose projection predates that field) and `contextWindow`.
- **Formula**: `(projectedTokens + maxTokens) / contextWindow >= thresholdRatio` → amber button; `>= 1` → red button (the budget already exceeds the window: the main request is rejected from here on, but a manual `/compact` still fits because its summarization call reserves only a small output cap — click it now).
- **Action**: the official `/compact` command channel (`remote.commands.execute` → host `ctx.commands` → `ctx.compaction.compactNow`), so the host owns idle-gating, the compaction lock, and the flow-node presentation.

## Configuration

The two tunables are editable in the GUI: **Settings → Plugins → "压缩按钮时机 / Compact button timing"** — the card writes the shared `context-guard` settings section, and the button reacts to the saved values live, with no restart. The YAML composition entry below is the section's base layer: values the card does not override come from it, and both stack over the schema defaults.

| Key | Default | Meaning |
|---|---|---|
| `thresholdRatio` | `0.8` | Window fraction at which context + maxTokens shows the button (clamped to (0, 1]). |
| `maxTokens` | `256000` | Output budget the next request reserves, in tokens (clamped to >= 1). Default matches the deepseek adapter's output cap — the reservation the main request makes; set to your model's configured max output if it differs. A larger cap makes the guard appear earlier, exactly where a real request starts being rejected. The guard's precision hinges on how close the catalog's `contextWindow` is to the provider's real window: a smaller configured value is conservative (it warns earlier), while a larger one can let the red overdue state appear after the real rejection wall — prefer smaller over larger. |

**These two fields tune ONLY when the compact button appears.** The official compaction engine (compaction-basic) reads its own `thresholdRatio` / `maxTokens` / `auto` configuration and never touches this section — real compaction timing is not affected by these knobs.

Example composition (becomes the card's base layer):

```yaml
plugins:
  context-guard:
    thresholdRatio: 0.75
    maxTokens: 32768
```

## Model Experience

### What the model sees

Nothing changes. The button is composer chrome; clicking it runs the same `/compact` the user could type, and the session log sees a normal command lifecycle (and any compaction transaction) exactly as if it had been typed.

#### Token effect

None from the plugin itself; the compact it triggers replaces the shadowed span with a checkpoint exactly as a manual `/compact` does.

#### KV Cache effect

None.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.7`): ✅ full — the plugin touches only the official public stable surface (slots, the `contextPressure` projection, the commands Remote, the settings surface, locale, cordis 4.x, schemastery).
- source line (deepseek-harness master): ✅

## Known Limitations and Deferred Work

- **`maxTokens` is configured, not discovered.** The host resolves the effective output cap asynchronously (`ctx.llm.resolveModelInfo().defaultMaxTokens`), and a session projection cannot await an async resolution, so the plugin reads the configured budget (from the settings card or the base layer). If your model's cap differs from the default, set `maxTokens`; a conservative smaller value only makes the button appear earlier, which is safe — an early compaction always fits.
- **The button is a warning, not a guarantee.** Between "button appears" and "click", the context may keep growing; the host's `/compact` may report `busy` while the agent is running, and the compaction summary is subject to the same window fit as any request.
- **No auto-compaction.** The plugin only surfaces the manual action; the official 80% auto-compaction keeps running unchanged, and a compacted-away guard button disappears as soon as the projection reflects the shrunken surface.
