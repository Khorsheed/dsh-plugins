# @khorsheed/dsh-inline-html-render

English | [中文](README.md)

"Show me" stops being a code block — a `` ```dsh-card `` fence the agent writes turns into a live, clickable HTML card right in the conversation.

Without it, an agent that wants you to *see* a result can only paste code for you to imagine, or write an HTML file you have to open in a preview. This plugin swaps the fenced block whose info string is `dsh-card` for a sandboxed iframe — mid-message — that runs the authored HTML: inline between paragraphs and genuinely interactive, not ASCII art or a prose description.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/inline-html-card-1.png" width="640" alt="a dsh-card block in the agent's reply rendered as a tabbed data-observation card, flowing with the surrounding text">

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

- **Inline between paragraphs** — the card sits exactly where the agent wrote it, flowing with the surrounding text; not an attachment, not a sidebar.
- **Truly interactive** — the card runs in a `sandbox="allow-scripts"` iframe with full DOM/CSS/JS: hover, click, tab switching, inline SVG/canvas animation all work.
- **Strict sandbox** — an opaque origin (never `allow-same-origin`) plus an injected strict CSP (`connect-src 'none'`, scripts/styles inline only): card scripts cannot touch host DOM or cookies and cannot reach the network. The only way out is `window.dshBridge` with three capabilities — `openLink` (https only), `copy`, `download` (data: URLs only) — each validated host-side for source window and argument shape.
- **Auto-height** — the opaque origin keeps the parent from reading content height, so the card document posts its real content height on load/resize and the parent sizes to it (capped at 20000px against runaway cards).
- **Links follow the host's route** — `openLink` opens into the right-Sidebar Browser tab on hosts shipping ui-sidebar-browser, and falls back to a new window (`noopener`) otherwise; probed on every open, so hot-added or hot-removed tab types never wedge.
- **Zero-invasive, degrades by design** — it only rewrites DOM the official client has **already rendered** (inserting an iframe beside the code block and hiding the block); no official source is touched. Without this plugin, `` ```dsh-card `` is just a normal code block — nothing breaks.
- **Two bundled authoring skills** — the host half registers `inline-html-card` and `3d-artifact` (both with provider `inline-html-render`), discovered pull-style: the agent picks up the protocol when it needs to *draw*, instead of every session carrying it.

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-inline-html-render
```

Restart the web instance to activate; uninstall restores the previous composition exactly.

```sh
dsh plugin --profile web remove @khorsheed/dsh-inline-html-render
```

## Authoring for the agent

The two skills the host half registers, `inline-html-card` and `3d-artifact`, share one HTML-authoring protocol. Whenever the user wants a **visible result** ("show me", "preview", "make me a card", "compare these visual options", a clickable widget), the agent picks up this protocol. Core constraints (the full protocol lives in the bundled skills):

- Exactly one fenced block whose info string is exactly `dsh-card`; **three backticks, never four, never nested** — a nested fence is parsed as an outer code block and the card never renders.
- Self-contained content: all CSS/JS inline, images as `data:` URIs, zero runtime network.
- The content IS the card: render the thing itself, not a fake window/title-bar container around it.
- Never reach the host — open links, copy, and download through `window.dshBridge`.

`3d-artifact` targets single-file 3D / digital-twin HTML (three.js via whitelisted-CDN importmaps, GLB models inlined as base64, a self-embedded Tier1 CSP); the renderer respects a card's own CSP and never injects a duplicate.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — this plugin consumes only standard DOM plus the client-runtime `ClientContext`, with no host-service dependency; minHost is 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.2-rc.1) — the DOM anchors re-checked on master (0.1.7-rc.1) are unchanged: `CodeBlock` still renders the `.md-code-block` wrapper with the info string in its banner (a CSS-module hashed class, caught by the leading-text fallback), `AssistantMarkdown` still sets `data-streaming`, and `ui-sidebar-browser` still registers the `browser` right-Sidebar tab kind.

## Known Limitations

- **Depends on official rendered DOM details** — blocks are located via the `.md-code-block` wrapper, and recognition runs in three arms: the explicit `.infostring` element (older shape) → the banner's leading text (0.1.6 shape) → the **content signature** (0.1.7-rc.1+: `CodeToolbar` shows only the host's localized generic label for fence languages shiki cannot highlight, so `dsh-card` never reaches the DOM; there a complete HTML document — doctype/`<html` head, `</html>` tail — or a block carrying the verbatim strict-CSP meta counts as a card). Streaming completion is aligned via `AssistantMarkdown`'s `data-streaming`. This is the repo-accepted last-resort DOM-anchor pattern (same shape as message-tools' dom-hider). Known gap: on hosts where the info string is invisible, **bare HTML fragments** (not a complete document, no CSP meta) are no longer recognized as cards — author cards as complete documents; once the host ships a `data-lang` hook (proposal in docs/upstream-proposals) recognition falls back to the pure info string.
- **No network under the default CSP** — the injected default CSP allows no network at all, not even whitelisted CDNs (stricter than file-preview's Tier1); a card document's own embedded CSP wins (`3d-artifact` embeds the Tier1 CSP that whitelists two CDNs for `script-src`). For other network-bearing visuals use file-preview's HTML render path instead.
- **Card interaction state does not survive re-renders** — React rebuilds the code-block node on content change; the old iframe is collected and re-mounted, so transient state inside a card (inputs, scroll position) is lost.
- **Auto-height has edges** — height comes from the card's own report, capped at 20000px; rare continuously-growing layouts may need a manual re-scan to settle.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** The browser half is a pure DOM-layer effect: it owns no slot and registers no Remote, mutating only the DOM the official client already rendered — the same repo-accepted last-resort pattern as message-tools' dom-hider — so it composes as an independent package with no core edits. The host half (`src/index.ts`) does exactly one thing: once the skill registry is ready (awaited via `ctx.inject(['skills'], …)` rather than probed synchronously at apply time), it registers the two bundled content-only skills (a missing/malformed SKILL.md warns, never throws; a composition without the `skills` service stays pending, never fails boot). Identity triangle: the cordis.patch.yml row id `inline-html-render` = the package.json name = `PACKAGE_NAME` in `src/invariant.ts`; the invariant companion holds no runtime invariant and only marks the package alive for the loader.

| Module | Responsibility |
| --- | --- |
| `src/client/renderer.ts` | A `MutationObserver` watches the DOM; for each `.md-code-block` whose info string is `dsh-card` (an explicit `.infostring` or the banner's leading text) it reads the `<pre>` text (the raw HTML), inserts an iframe beside the block, and hides the block; never mounts while streaming (a `data-streaming` ancestor exists), re-scans once settled; collects orphaned iframes and re-mounts when React rebuilds a block. |
| `src/client/srcdoc.ts` | Wraps the card HTML into a complete srcdoc document carrying the strict CSP plus `dshBridge`: fragments get `<html>/<head>` synthesized, full documents get the injection right after their `<head>`; a card that already declares a CSP is not given a duplicate. The sandbox never carries `allow-same-origin`. |
| `src/client/bridge.ts` | Host-side validation of every iframe message (`event.source` must be the controlled frame's window, an `fn` whitelist, per-function argument shapes), answering `openLink/copy/download` and height reports; unknown or malformed calls get an error reply, never a host exception. |

**Why a sibling instead of replacing the node**: React owns the markdown tree, so a bare `removeChild` would make React's reconciliation fight the DOM (potentially throwing or resurrecting the block). The plugin never removes a React node — the iframe is inserted as a sibling right after the block, the block is hidden with `style.display='none'` (a style React does not manage), and a MutationObserver re-scans on every change; when React replaces a node, the new block is caught and hidden again.

**Streaming alignment**: while a turn runs, `AssistantMarkdown` sets `data-streaming` on its root and the block content is partial and re-rendered; the plugin only mounts when no `data-streaming` ancestor exists, so a card never renders on a half-streamed body. When the turn ends, React re-renders, drops the attribute, and rebuilds the block — the observer swaps then.

**Link routing**: `openLink` probes `sidebarRightTabs`/`sidebarRight` on every open — when the host registers the `browser` tab kind (ui-sidebar-browser) the link opens as a right-Sidebar Browser tab; a failed probe or a throwing open falls back to `window.open` (https, `noopener`). The bridge handler enforces https-only targets.

**For plugin authors**: the card protocol is pull-based (a skill), not pushed to every session — just write self-contained HTML inside a `` ```dsh-card `` fence.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/inline-html-render`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
