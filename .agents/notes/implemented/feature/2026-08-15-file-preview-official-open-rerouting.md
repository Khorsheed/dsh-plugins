# Agent Note: Rerouting official file opens into the file-preview drawer

Status: implemented

English | [中文](2026-08-15-file-preview-official-open-rerouting.zh.md)

## Problem

The [file-preview drawer](2026-08-14-file-preview-side-drawer.md) gave the plugin's own surfaces in-place previews, but the two official file entries still opened the host OS: the produced-files row chips (`ui-deliverables`' `ProducedFiles`, onClick closing over the chat view's injected `openFile`) and the closing-prose mentions (the singly-provided `chatFileMentions` service — cordis rejects a second provider with "service has been registered"). Neither surface exposes a slot, service, or event a third party can override, and the plugin's distribution constraint forbids editing core packages. The investigation also corrected a wrong premise in the drawer note: the `conversation.chat.turnTail` chain does not render every registrant — election is the first non-null `select` in ascending priority order (`packages/client/web-react/src/scoped-slots.tsx`), so the plugin's row and the official row were already mutually exclusive per turn at the default priority 0, with registration order deciding the winner.

## Decision

> Retired at host 0.1.5-rc.1: both mechanisms below were removed in ui-file-preview 0.3.0 when the right-Sidebar resource routing landed (seam registry S1). See [the retirement note](../architecture/2026-09-10-ui-file-preview-sidebar-right-s1-retirement.md).

Two additive mechanisms reroute every official file entry into the drawer, both marked `TODO(official-opener-seam)` with the retirement condition and the per-upgrade re-check list.

**Chain preemption for the produced-files row.** The plugin's turn-tail entry registers at `priority: -1`, and its `selectTurnFiles` unions its own mutated-files vocabulary (the write/edit `file_path` arguments plus per-file line deltas from their diff call views) with the official `deliverables` Turn data (read structurally through a type-only import of `@deepseek-ai/dsh-client-ui-deliverables/client` — the client bundle purity gate forbids the cross-plugin value import of `producedForClosing`). The entry renders a "N files changed" mutation card whose file rows open the drawer: it claims every file-mutating turn, the official entry never mounts, and its OS-open chips disappear with it. When ui-deliverables is composed out, the `deliverables` key is simply absent and the union degrades consistently. If the chain semantics ever change upstream, the worst case is the official row reappearing — a silent return to the previous behavior, never a crash.

**Capture-phase interception for prose mentions** (`mention-intercept.ts`). No slot or service seam reaches the mention `open` closure, so a document-level click listener in the capture phase runs before React 17+'s root-container listener and reroutes confirmed hits. Three gates keep it from ever claiming a foreign button: the `code > button[title]` structure, an absolute-path `title`, and a label equal to the path or its basename; the plugin's own surfaces (`[role="dialog"]`, `[data-turn-file-row]`) are excluded, and anything unrecognized passes through untouched (fail-open — the worst case is the official OS open). `click`, not `pointerdown`, so keyboard and assistive-technology activation are intercepted identically. The listener rides `ctx.effect`, so plugin disposal removes it.

## Alternatives considered

**An upstream opener seam** (an optional opener service the chat view's `openFile` inject consults, or a replaceable `chatFileMentions`). The cleanest fix — one seam covers both surfaces with zero DOM dependency — but the upstream currently accepts no PRs. Recorded as the retirement condition in the `TODO(official-opener-seam)` markers rather than implemented.

**Shadowing the keyed `assistant-step` chat-node renderer.** A higher-priority keyed entry receives the same owner props (including `fileMentions` and `openFile`) and could own mention clicks with no DOM work. Rejected: it must re-render the entire assistant message — markdown, steps, action rows — and forfeits every upstream improvement to `AssistantNodeView`, a maintenance cost far above one click listener.

**Wrapping `workspaces.openPath`.** Rejected: it is a host RPC channel shared by every caller (tool rows, show-in-folder, directories), not a per-surface replaceable object.

**Pure DOM interception for both surfaces** (the earlier proposal). Rejected for the row: the chain already governs that surface through a public API, so depending on the unofficial `data-produced-files-row` attribute there is strictly worse.

**Providing `chatFileMentions` first.** Rejected: the second `provide` — ui-deliverables' own — would then throw at load, turning a rerouting into a boot failure.

## Consequences

Every official file entry previews in place with zero core edits, and the preemption half carries no DOM dependency at all. The costs: one document-level capture listener; one unofficial DOM structure dependency whose failure mode is a silent return to the OS open; and a structural read of another plugin's Turn data whose shape the union-select tests pin. The upgrade re-check list lives in the two `TODO(official-opener-seam)` markers: chain election stays first-match by ascending priority, the `deliverables` Turn-data key keeps its `{ seq, path }[]` shape, and mentions still render as `code > button[title]` with an absolute-path title. The drawer note's "chain renders every registrant, the two rows coexist" claim is corrected by this note. Coverage: the union-select matrix and the interceptor's gate matrix are unit-tested, and a plugin-level test reroutes a real dispatched mention click into the drawer store.
