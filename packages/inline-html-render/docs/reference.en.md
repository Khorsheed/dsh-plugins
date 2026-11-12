# @khorsheed/dsh-inline-html-render — full reference

> The complete developer and agent reference: the sandbox and capability bridge, the card authoring protocol, how cards are detected in the DOM, and internals. Until 2026-10-26 this was the package README; the user-facing overview is the [README](../README.en.md).

English | [中文](reference.md)

"Show me" stops being a code block — a `` ```dsh-card `` fence the agent writes turns into a live, clickable HTML card right in the conversation.

Without it, an agent that wants you to *see* a result can only paste code for you to imagine, or write an HTML file you have to open in a preview. This plugin swaps the fenced block whose info string is `dsh-card` for a sandboxed iframe — mid-message — that runs the authored HTML: inline between paragraphs and genuinely interactive, not ASCII art or a prose description.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/inline-html-card-1.png" width="640" alt="a dsh-card block in the agent's reply rendered as a tabbed data-observation card, flowing with the surrounding text">

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
- **Public slot first, degrades by design** — host 0.2.2-rc.2 renders cards through the official Markdown fence slot; older hosts use the legacy path that rewrites **already-rendered** DOM (inserting an iframe beside the code block and hiding it), with no official source touched. Without this plugin, `` ```dsh-card `` is just a normal code block — nothing breaks.
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

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — older hosts use standard DOM plus the client-runtime `ClientContext`; minHost is 0.1.2-rc.1 — older hosts stay on the previous release line.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.2.2-rc.2) — the `dsh-card` layer registers into `conversation.chat.markdown.fence`; streaming, mounting on settle, disposal, and the legacy DOM fallback are covered by the build and 41 tests. A real rc.2 Chromium composition also rendered the authored card through the official slot with `sandbox="allow-scripts"` and no browser or console errors.

## Known Limitations

- **Older hosts still depend on official rendered DOM details** — host 0.2.2-rc.2 supplies the `dsh-card` language through the official fence slot. Older hosts locate `.md-code-block` wrappers and recognize an explicit `.infostring`, the banner's leading text, or a **content signature** (a complete HTML document or the verbatim strict-CSP meta), with `data-streaming` marking incomplete content. Only the legacy path has a recognition gap: **bare HTML fragments** are not recognized when the language is invisible, so author complete documents.
- **No network under the default CSP** — the injected default CSP allows no network at all, not even whitelisted CDNs (stricter than file-preview's Tier1); a card document's own embedded CSP wins (`3d-artifact` embeds the Tier1 CSP that whitelists two CDNs for `script-src`). For other network-bearing visuals use file-preview's HTML render path instead.
- **Card interaction state does not survive re-renders** — code changes rebuild the iframe, so transient state inside a card (inputs, scroll position) is lost.
- **Auto-height has edges** — height comes from the card's own report, capped at 20000px; rare continuously-growing layouts may need a manual re-scan to settle.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** On host 0.2.2-rc.2 the browser half registers a language layer through `slots.inject('conversation.chat.markdown.fence', …)` in a nested scope that injects only `slots`. The legacy DOM observer covers hosts without the fence declaration and is disposed when the language registration succeeds, so activation order cannot produce duplicate frames. No Remote is registered. The host half (`src/index.ts`) waits for the skill registry via `ctx.inject(['skills'], …)` and registers the two bundled content-only skills (a missing/malformed SKILL.md warns, never throws; a composition without `skills` stays pending, never fails boot). Identity triangle: the cordis.patch.yml row id `inline-html-render` = the package.json name = the tsdown `clientBundle` id.

| Module | Responsibility |
| --- | --- |
| `src/client/fence.tsx` | Registers the `dsh-card` language layer; keeps the plain code block while streaming, mounts the sandbox on settle, and releases owned listeners and timers on disposal. |
| `src/client/frame.ts` | The iframe lifecycle shared by both paths: srcdoc, loading state and capability bridge creation, and complete disposal. |
| `src/client/renderer.ts` | The legacy DOM fallback: a `MutationObserver` finds `dsh-card` blocks, inserts an iframe container beside each block and hides the original; orphaned containers are collected when React rebuilds a block. |
| `src/client/loading.ts` | Parent-side loading state covering first paint; accepts `ready` only from the controlled iframe, ignoring the initial empty document's load; after a 10-second stall shows an error and retry, and disposal clears the timer and message listener. |
| `src/client/srcdoc.ts` | Wraps the card HTML into a complete srcdoc document carrying the strict CSP plus `dshBridge`: fragments get `<html>/<head>` synthesized; authored CSP metas move into the `<head>` wherever they appeared, and the default policy is added only when none exists, never duplicated. The sandbox never carries `allow-same-origin`. |
| `src/client/bridge.ts` | Host-side validation of every iframe message (`event.source` must be the controlled frame's window, an `fn` whitelist, per-function argument shapes), answering `openLink/copy/download` and height reports; unknown or malformed calls get an error reply, never a host exception. |

**Why the legacy path uses a sibling instead of replacing the node**: React owns the markdown tree, so a bare `removeChild` would make React's reconciliation fight the DOM (potentially throwing or resurrecting the block). The legacy path never removes a React node — the container is inserted as a sibling, the block is hidden with `style.display='none'`, and a MutationObserver re-scans on every change. The slot path lets React own the container directly and needs no such workaround.

**Streaming alignment**: the slot consumes the official `streaming` flag and renders the official children until the fence settles. The legacy path mounts only when no `data-streaming` ancestor exists and re-scans after the turn ends.

**Link routing**: `openLink` probes `sidebarRightTabs`/`sidebarRight` on every open — when the host registers the `browser` tab kind (ui-sidebar-browser) the link opens as a right-Sidebar Browser tab; a failed probe or a throwing open falls back to `window.open` (https, `noopener`). The bridge handler enforces https-only targets.

**For plugin authors**: the card protocol is pull-based (a skill), not pushed to every session — just write self-contained HTML inside a `` ```dsh-card `` fence.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/inline-html-render`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](../CHANGELOG.md).
