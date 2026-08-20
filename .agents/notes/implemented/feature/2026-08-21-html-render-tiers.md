# Agent Note: HTML 渲染分级——M1 通道上限 + M2 Tier0/Tier1 沙箱与能力桥

Status: implemented

English | [中文](2026-08-21-html-render-tiers.zh.md)

## Problem

The file view could only render HTML statically (`sandbox=""`, scripts never
run) and files over 512 KiB never reached the render channel at all. The
file-view-html-rendering proposal's M1/M2 close both gaps: a wider HTML-only
read cap and a scripted tier behind an explicit user gate, without weakening
the security boundary (opaque origin, no network, no host access).

## Decision

**M1 (file-preview, `a4d7883`)** — HTML gets its own read cap
(`htmlMaxReadBytes`, default 4 MiB) while every other text read keeps
`maxReadBytes` (512 KiB); `read` returns `htmlScripted` when the document
contains `<script>`, inline event handlers, or `javascript:` URLs — a hint for
default-mode selection and warning only, never a trust decision.

**M2 (ui-file-preview, `e981c25`)** —
- `buildSrcDoc` (html-src-doc.ts): the `srcdoc` always embeds the Tier1 meta
  CSP — the web shell has no CSP of its own and `srcdoc` is not served as an
  HTTP response, so inheritance cannot be relied on; fragments are wrapped,
  full documents get the meta injected into their own `<head>` (an existing
  CSP is never duplicated). Tier1 additionally injects a `content-visibility`
  deferral style and the `dshBridge` capability client.
- `attachBridge` (html-bridge.ts): the only way out of a Tier1 frame — every
  `postMessage` is validated (`event.source` must be the controlled iframe,
  `fn` in the whitelist, args shape-checked) before `openLink` (https-only,
  `noopener,noreferrer`), `copy` (async clipboard + execCommand fallback), or
  `download` (data:-only) runs; errors reply, never throw in the host.
- FilePreviewPane: render stays static by default; scripted documents offer a
  「运行脚本」segment that opens a one-time confirm; confirming switches the
  iframe to `sandbox="allow-scripts"` — **never `allow-same-origin`**, keeping
  the opaque origin (and with it site-isolation process isolation). A 10 s
  watchdog without an iframe load suggests the source view or a browser open.

## Alternatives considered

- **Always allow scripts (no confirm gate)**: rejected — scripts are the
  capability the boundary exists to contain; an explicit per-file gesture is
  the whole point of Tier1 vs Tier0.
- **`allow-scripts` + `allow-same-origin` (convenience)**: rejected — the
  frame could then strip its own sandbox and reach the host; never combined.
- **CSP only via the parent shell / HTTP header**: rejected — the shell has no
  CSP and `srcdoc` has no HTTP response; the policy must live in the document.

## Consequences

- >512 KiB HTML files now render instead of answering `too-large`; scripted
  documents can run behind an explicit gate with the same boundary the static
  tier has plus a CSP.
- The bridge is a new (small, whitelist-shaped) attack surface — validated
  source + function whitelist + arg shape; capabilities are added only by
  expanding `HANDLERS` with the same validation.
- Existing srcdoc assertions changed (the document is now wrapped); 7 new
  unit tests cover the wrapper, the bridge, and the confirm-gated Tier1 flow.
