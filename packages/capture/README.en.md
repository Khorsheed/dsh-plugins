# @khorsheed/dsh-capture

English | [中文](README.md)

Render first, then capture — lazy-loaded figures, IntersectionObserver-triggered content, and figures the page's own scripts draw all come back with it.

A static fetch only gets the HTML the server emitted, and on a JS-heavy page that is often an empty div plus a caption. This plugin keeps a managed headless Chrome on the host side, actually renders the URL — scrolls to the bottom, waits for the scripts to finish painting — then brings back the **rendered DOM**, serialized: every matched CSSOM rule inlined per element (`var()` resolved), every script stripped. Static-HTML extractors (like the inspiration-space reader) gain eyes for JS-heavy pages.

## Features

- **One Remote verb, `capture.render`** — the host exposes the Typert Remote namespace `capture`; the request is `{ url, timeoutMs? }`, the result is the rendered HTML (plus `finalUrl` / `title` / `truncated`). A bad URL, a private-network target, an unavailable browser, a timeout, or a full queue is a `RemoteError` with a `capture/*` code landing in the `RemoteResult` error branch — the success value never doubles as a second `{ ok }` union.
- **Real rendering, not source fetching** — a managed headless Chrome (Chrome for Testing) runs the page to network quiescence, then sweeps to the bottom in viewport steps, dwelling 500ms per step so lazy figures render; script-driven interactive widgets (canvases, listener-driven figures) are snapshotted into static WebP images before serialization, their searchable text kept in `alt`.
- **Styles travel with the DOM** — matched CSSOM rules resolve by cascade into per-element `style` attributes; SVG presentation properties (`fill`/`stroke`/…) are ALSO written as attributes, so a downstream whitelist that keeps attributes but strips `style` still sees the colors; `<script>`, `<style>` and stylesheet `<link>` elements are all removed.
- **An SSRF gate re-checked per hop** — http(s) only, credential-bearing URLs refused; the hostname goes through the system resolver and EVERY answer must be a public address; every redirect hop re-runs the policy, so a public URL cannot 302 into the private network.
- **Zero login state, zero residue** — every render gets a fresh temporary BrowserContext: no cookies, credentials, or storage survive a render; `pipe: true` rides stdio and listens on no TCP port; the process exits after 60s idle.
- **A broken install never breaks boot** — the browser binary downloads on the FIRST render into `$DSH_HOME/state/dsh-capture` (deployment state, never the package directory); an install/launch failure is that call's `capture/unavailable`, never a boot crash. Callers probe `remote.capture` and everything behaves exactly as before when this package is absent.

## The contract

```ts
render({ url, timeoutMs? }) → {
  html: string        // <!DOCTYPE html> + the rendered document, styles inlined, scripts removed
  finalUrl?: string   // where redirects landed
  title?: string      // document.title
  truncated?: boolean // set when the serialized output was cut at the cap
}
```

The browser half is **mount-only** (it mounts the generated Remote contribution so `remote.capture` exists for callers) and carries no UI — a settings page is deliberately deferred: v1's only caller gesture is the reader's 「渲染抓取」 click, and that click IS the approval. Callers probe the `remote.capture` namespace and degrade silently when it is absent (the reader simply never renders that gesture).

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-capture
```

Restart the web instance to activate. The package self-mounts (`dsh.bundle.patch` → `cordis.patch.yml`, row id `capture`): `dsh plugin add` reconciles that row into the profile — no hand-edited cordis.yml; a composition must mount the row exactly once.

```sh
dsh plugin --profile web remove @khorsheed/dsh-capture
```

After removal, callers' probes find no `remote.capture` and behave as if it were never installed (the reader's 「渲染抓取」 gesture disappears whole, without errors).

## Configuration

The cordis.yml row's `config` (all optional):

| Key | Default | Meaning |
|---|---|---|
| `stateRoot` | `$DSH_HOME/state/dsh-capture` | State root (binary + throwaway profiles + state.json) |
| `executablePath` | — | Explicit Chrome/Chromium executable (skips the managed download) |
| `channel` | — | System channel (e.g. `chrome`), resolved by puppeteer itself |
| `chromeBuildId` | `stable` | Chrome for Testing build tag for the managed download |
| `defaultTimeoutMs` | `30000` | Default navigation timeout (caller `timeoutMs` clamps to 1s–120s) |
| `maxChars` | `8000000` | Serialized-output cap (chars) |
| `idleTimeoutMs` | `60000` | Idle delay before the managed browser exits |
| `maxQueue` | `4` | Wait-line length (the in-flight render excluded) |
| `dwellMs` | `500` | Sweep dwell per step (IntersectionObserver needs ≥ ~400ms) |
| `maxSweepMs` | `20000` | Total sweep budget |
| `snapshotWidgets` | `true` | Snapshot JS-driven widget figures to static images before serializing |
| `maxSnapshots` | `40` | Most widget snapshots one render takes (document order; the rest keep their DOM) |
| `extraArgs` | `[]` | Extra Chrome command-line arguments (deployment escape hatch) |

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — minHost IS 0.1.5-rc.1 (`dsh.compat.verifiedHost`), full build+test green; the Remote face depends only on the Typert protocol and (for the browser-half mount) api-remotes.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.5-rc.1) — tracked upstream, never via a local fork.

Every degradation is silent, never a boot failure: with no Chrome binary every call earns `capture/unavailable`; with no writable disk the allow records stay in memory; a composition without session, fs, or web seams boots all the same. The browser half mounts the namespace in any web composition; a headless composition has no `remote` service and the mount skips silently. The machine-readable twin lives in package.json's `dsh.compat`.

## Known Limitations

- **Interactive controls freeze** — the serialization is a static DOM: buttons, inputs and expanders lose their behavior (scripts never ship with the product anyway); JS-driven widget figures arrive as static snapshot images by default.
- **Headless ≠ pixel-perfect** — fonts, GPU rasterization and some DRM content differ under `--headless=new` from a daily browser; this package does not claim a faithful mirror.
- **Cross-origin stylesheets are unreadable** — the browser refuses their CSSOM (SecurityError); they are skipped and counted: only colors from those sheets are lost.
- **The cascade is approximate** — specificity is a compact hand-computed implementation (`:is()` takes its arguments' maximum, `:where()` is zero), `@container`/`@scope` contents are included unconditionally, `@layer` follows document order; pseudo-element styles (`::before` content and the like) are not inlined; and when an inline shorthand carrying `var()` and a matched rule contest the same property, the rule wrongly wins (the inline declaration should) — bounded to that one combination. Accurate for the declarations that color figures; not a promise for whole-page layout reproduction.
- **Lazy loading has a budget** — the sweep's total budget is 20s; longer pages capture as far as the budget reached.
- **A login-walled page captures as its login wall** — every render is a zero-cookie fresh context: by design, not by defect.
- **v1's allow record gates nothing** — after the first SUCCESSFUL render of a host, an allow record persists (first-allowed instant, latest render, count; 500 records, LRU-evicted) so a future non-interactive caller can be gated on "approved before"; in v1 it is bookkeeping only, and dangerous targets refuse regardless of any record.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**The render pipeline (one render's path).**

1. **URL policy**: http(s) only; URLs carrying credentials (`user:pass@host`) are refused — this package never carries login state. The hostname is resolved with the system resolver and EVERY answer must be a public address; IP literals (including exotic forms like `2130706433` or `0x7f.1` that the WHATWG parser normalizes) are classified directly. Loopback / RFC1918 / CGNAT / link-local (including the `169.254.169.254` cloud metadata address) / multicast / reserved ranges all refuse; IPv4-mapped, NAT64 and 6to4 IPv6 forms are classified by their embedded IPv4. `localhost` refuses by name, before DNS.
2. **The queue**: one render at a time (a headless Chrome holds hundreds of MB), a bounded wait line, `capture/busy` beyond it.
3. **The managed browser**: one Chrome process (`pipe: true` over stdio — no TCP port is ever listened on; `--headless=new`), **a fresh temporary BrowserContext per render**. The process exits after 60s idle and relaunches on the next render; a crash relaunches on the next render too. The binary is Chrome for Testing, downloaded lazily on the first render; `executablePath` / `channel` config switches to a system Chrome.
4. **Interception + navigation**: request interception is on and **every redirect hop re-runs step 1's policy** (a public URL 302ing into the private network is the classic SSRF escape — the per-hop re-check exists for exactly that). Subresources pass on http(s)/data/blob; other schemes (file:, chrome:, …) abort. HTTP ≥ 400 is `capture/navigation-failed`; a navigation timeout is `capture/timeout` (default 30s, overridable via `timeoutMs`, clamped to 1–120s).
5. **Quiescence**: after `load`, wait for network silence (no in-flight request for 500ms, capped at 5s).
6. **The scroll sweep**: step down the page by 0.8 viewport, **dwelling 500ms per step** — measured on transformer-circuits.pub: of 102 figures, ~20 render only via IntersectionObserver, and a 120ms/step sweep does not trigger them. The sweep never scrolls back (a virtualizing page could drop off-screen content).
7. **Widget snapshots**: a listener probe installed before any page script has already tagged the event-driven elements; now, in document order, canvases and listener-driven figures are screenshotted into WebP data URIs (2x raster keeps text crisp, `alt` keeps up to 400 chars of searchable text) and their subtrees swapped for `<img>`s. Widgets larger than 4096px and widgets whose own screenshot fails keep their DOM; a wholesale snapshot-phase failure is only logged, never sinks the render. `snapshotWidgets: false` turns the phase off.
8. **Inline + serialize**, in the live document: matched CSSOM rules resolve by (`!important` → inline-ness → specificity → document order) into element `style` attributes; `var(--x)` resolves along the custom-property cascade (fallbacks, nesting, cycle guard; script-set or cross-origin-defined custom properties fall back to `getComputedStyle`); SVG presentation properties are ALSO written as attributes — a downstream whitelist that keeps attributes but strips `style` still sees the colors. A `var()` a page script wrote directly as a presentation attribute (`fill="var(--brand)"`) or inside an inline shorthand (a browser decomposes `background: var(--x)` into pending-substitution longhands that enumerate empty — only the attribute text still carries it) is resolved textually before serialization — measured zero leftover `var()` references on the full transformer-circuits page. Then all `<script>`, `<style>` and stylesheet `<link>` elements are removed (with rules inlined, style blocks are redundant bytes), the document serializes as `<!DOCTYPE html>` + `documentElement.outerHTML`, and output past the cap (default ~8M chars) is cut with `truncated` set.

**Permission model (v1): the gesture gate.** Callers invoke `render` only on an explicit user click — that click is the approval. After the first SUCCESSFUL render of a site (by hostname), an allow record persists in `state.json` so a future non-interactive caller can be gated on "approved before"; in v1 the record gates nothing, and a failed render approves nothing. Persistence is atomic `node:fs` (temp file + rename) — **not** `ctx.fs` (the session-policy-fenced sandboxed filesystem); an unwritable disk degrades to memory-only, and a corrupt state file reads as empty but is **never overwritten**.

**Threat model.**

- **Untrusted page content enters the plugin pipeline**: the rendered product is attacker-controlled text and may literally say "ignore your previous instructions". This package's mitigations are the URL policy, the gesture gate, and the output cap; **the prompt-injection surface is the caller's whitelist problem** — the reader runs captured markup through the same whitelist normalization as any fetched page and never renders raw captures. Never treat `render`'s output as trusted content.
- **No login state is carried**: every render is a fresh temporary BrowserContext; credential-bearing URLs are refused; the managed instance is not your daily browser and your cookies are not in it.
- **SSRF**: private/loopback/link-local/metadata addresses are re-checked after EVERY redirect hop; a resolution failure refuses (an unvalidated host is never navigated to).
- **Process surface**: the pipe transport listens on no port; throwaway profile directories are cleaned at exit (stale ones are swept before the next launch); the binary comes from Google's official Chrome for Testing channel.

**Architecture.** The host half's `apply` provides the `capture` service core (`ctx.provide('capture', …)`) and mounts the thin Remote face `captureRemote` (namespace `capture`, a one-line delegation to the core); the browser half mounts the generated Remote contribution via `ctx.remote.$mount` and carries no UI. The identity triangle: the `cordis.patch.yml` row name, the tsdown `clientBundle` id, and `src/invariant.ts`'s `PACKAGE_NAME` are all `@khorsheed/dsh-capture`.

**Exports.** The main entry exports `CaptureService`, `CaptureBrowserManager`, `SerialRenderQueue`, `CaptureStore`, the pure URL-policy and page-task helpers, and every wire type; `/client` exports the browser half (`apply`/`inject`), `/remote` is the generated client-side Remote contribution, `/types` carries the wire types, and `/invariant` is the capability-probe companion.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/capture`). Issues and contributions welcome there.

```sh
pnpm install && pnpm run build   # gen-typert → tsc → tsdown (host face first)
pnpm run test                    # vitest: pure tests + real-Context boot + integration
```

The integration suite (`tests/render.integration.spec.ts`) drives a real Chrome against a local fixture server (an IntersectionObserver figure, a CSS-variable SVG, a redirect escape); **it skips wholesale when no Chrome binary exists** (CI has none). Three ways to give the tests a binary: the `DSH_CAPTURE_CHROME_PATH` env var, the managed install under the default state root, or the system `chrome` channel.
