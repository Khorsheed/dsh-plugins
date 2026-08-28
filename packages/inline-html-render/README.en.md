# @khorsheed/dsh-inline-html-render

[English](README.en.md) | 中文

A plugin that lets the agent render **interactive HTML cards** directly in the conversation. When the agent writes a ` ```dsh-card ```` fenced block, the plugin swaps that region in the middle of the message flow for a **sandboxed iframe** running the authored HTML — genuinely inline and interactive, not ASCII art or a prose description.

```dsh-card
<div style="font:14px system-ui;padding:16px;background:#1e1e1e;border-radius:10px;color:#eee">
  <div style="font-weight:600;margin-bottom:8px">design token reference</div>
  <div style="display:flex;gap:8px">
    <span style="background:#4f8cff;color:#fff;padding:4px 10px;border-radius:6px">primary</span>
    <span style="background:#2ea043;color:#fff;padding:4px 10px;border-radius:6px">success</span>
    <span style="background:#d29922;color:#fff;padding:4px 10px;border-radius:6px">warning</span>
  </div>
</div>
```

In the session, that is not a code block — it is a rendered card.

## Features

- **Inline in the middle of the paragraph** — the card sits exactly where the agent wrote it, flowing naturally with the surrounding text.
- **Truly interactive** — the card runs in a `sandbox="allow-scripts"` iframe and supports arbitrary DOM/CSS/JS interaction (hover, click, tab switching, inline SVG/canvas animation).
- **Zero-invasive to official code** — it only mutates the DOM the official client has **already rendered** (inserts an iframe beside the rendered `.md-code-block` and hides that block); no official source is touched. Without this plugin the ` ```dsh-card ```` block simply degrades to a normal code block, never crashing.
- **Strict sandbox** — a CSP is injected (`connect-src 'none'`), so the card's scripts cannot reach the network or the host. Only three controlled `window.dshBridge.openLink / copy / download` capabilities are exposed.

## Install

Not in the default web bundle; install and mount with one command (self-mounting via `dsh.bundle`):

```sh
dsh plugin --profile <p> add @khorsheed/dsh-inline-html-render      # install
dsh plugin --profile <p> remove @khorsheed/dsh-inline-html-render   # uninstall
```

## Authoring for the agent

The host half registers the `inline-html-card` skill. Whenever the user wants a **visible result** ("show me", "preview", "make me a card", "compare these visual options", a clickable widget) rather than a paragraph of text, the agent picks up this protocol. Core constraints (see the skill):

- Exactly one fenced block whose info string is exactly `dsh-card`; use **three** backticks ( ``` ), never four — four backticks or a nested fence make the parser read it as an outer block and the card never renders.
- Self-contained content: inline CSS/JS, `data:` URIs for images, zero external network.
- Never reach the host — use `window.dshBridge` for opening links / copying / downloading.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.1-rc.2`): ✅ full — this plugin consumes only standard DOM + the client runtime `ClientContext`; the `.md-code-block` wrapper, its banner info-string display, and the `data-streaming` attribute that `ui-conversation` renders are unchanged within this API audit.
- Source line (deepseek-harness master): ✅

## Known limitations

- **Depends on official rendered DOM details** — the renderer locates blocks via the `.md-code-block` wrapper and the leading `dsh-card` text in its banner (this release's official CodeBlock renders a hashed banner wrap with no stable `.infostring` class; also compatible with an explicit `.infostring` element), and aligns streaming completion via `AssistantMarkdown`'s `data-streaming`. This is the repo-accepted last-resort DOM-anchor pattern (same shape as message-tools' dom-hider). If the official client changes the wrapper class, the banner text shape, or the info-string placement, the MutationObserver fallback path must be re-verified.
- **No network in the sandbox** — card scripts cannot `fetch`/load external resources (even whitelisted CDNs are not allowed; stricter than file-preview's Tier1). For network-bearing visuals use file-preview's HTML render path instead.
- **Auto-height iframe** — the iframe is sized to its content height; rare dynamically-growing layouts may need a manual `data-dsh-card` re-mount.

## Implementation

<details>
<summary>Internal structure (expand)</summary>

- `src/index.ts` (node half) — registers the `inline-html-card` skill (`skills` service optional; degrades silently when absent).
- `src/client/` (browser half, `/plugins/inline-html-render/client.js`):

| Module | Responsibility |
| --- | --- |
| `renderer.ts` | A `MutationObserver` watches the DOM; for each `.md-code-block` whose info string is `dsh-card` (an explicit `.infostring` or the banner's leading text), reads the `<pre>` text (the raw HTML), inserts an iframe beside the block, hides the block; never mounts while streaming (`data-streaming` present), re-scans once it settles. |
| `srcdoc.ts` | Wraps the card HTML into a full document carrying the strict CSP + `dshBridge` (`srcdoc`). |
| `bridge.ts` | Host-side validation of iframe messages (source window + whitelist + arg shape), answering `openLink/copy/download`. |

**Why a sibling instead of replacing the node**: React owns the markdown tree, so a bare `removeChild` would make React's reconciliation fight the DOM (potentially throwing or resurrecting the block). So this plugin never removes a React node — it inserts the iframe as a sibling **after** the block, hides the block with `style.display='none'` (a style React does not manage), and re-scans with a MutationObserver on every change. When React replaces a node (rebuilding it on content change), the new block is caught and hidden again.

**Streaming alignment**: while a turn runs, `AssistantMarkdown` sets `data-streaming` on its root and the block content is partial and re-rendered. The plugin only mounts when there is no `[data-streaming]` ancestor, so a card never renders on a half-streamed body. When the turn ends, React re-renders, removes `data-streaming`, and rebuilds the block; the observer swaps then.

**For plugin authors** — the card protocol is pull-based (a skill), not pushed to every session. Just write self-contained HTML inside ` ```dsh-card ````.

</details>

## License

MIT
