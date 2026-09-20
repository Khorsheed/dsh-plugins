# @khorsheed/dsh-capture

English | [中文](README.md)

**Rendered fetch** — a host-side service: load a URL in a managed headless Chrome, wait until it has actually rendered (lazy figures, IntersectionObserver, a d3 bundle running live), then bring back the **rendered DOM** serialized — every matched CSSOM rule inlined per element (`var()` resolved), every script stripped. It gives static-HTML extractors (like the inspiration-space reader) eyes for JS-heavy pages.

## The contract

The host exposes one Typert Remote namespace `capture` with one verb `render`:

```ts
render({ url, timeoutMs? }) → {
  html: string        // <!DOCTYPE html> + the rendered document, styles inlined, scripts removed
  finalUrl?: string   // where redirects landed
  title?: string      // document.title
  truncated?: boolean // set when the serialized output was cut at the cap
}
```

Refusals (bad URL, private-network target, unavailable browser, timeout, full queue) are `RemoteError`s carrying `capture/*` codes and land in the `RemoteResult` error branch — the success value never doubles as a second `{ ok }` union. The browser half is **mount-only** (it mounts the generated Remote contribution so `remote.capture` exists for callers); there is no UI — a settings page is deliberately deferred (v1's only caller gesture is the reader's 「渲染抓取」 click, and that click IS the approval).

Callers probe the `remote.capture` namespace: absent, they degrade silently (the reader simply never renders that gesture); everything behaves exactly as before when this package is not installed.

## The render pipeline (one render's path)

1. **URL policy**: http(s) only; URLs carrying credentials (`user:pass@host`) are refused — this package never carries login state. The hostname is resolved with the system resolver and EVERY answer must be a public address; IP literals (including exotic forms like `2130706433` or `0x7f.1` that the WHATWG parser normalizes) are classified directly. Loopback / RFC1918 / CGNAT / link-local (including the `169.254.169.254` cloud metadata address) / multicast / reserved ranges all refuse; IPv4-mapped, NAT64 and 6to4 IPv6 forms are classified by their embedded IPv4. `localhost` refuses by name, before DNS.
2. **The queue**: one render at a time (a headless Chrome holds hundreds of MB), a bounded wait line, `capture/busy` beyond it.
3. **The managed browser**: one Chrome process (`pipe: true` over stdio — no TCP port is ever listened on; `--headless=new`), **a fresh temporary BrowserContext per render** — zero cookies, credentials, or storage survive a render. The process exits after 60s idle and relaunches on the next render; a crash relaunches on the next render too. The binary is Chrome for Testing, downloaded **lazily on the first render** into `$DSH_HOME/state/dsh-capture/` (deployment state, never the package directory); an install/launch failure is that call's `capture/unavailable`, **never a boot crash**. `executablePath` / `channel` config switches to a system Chrome.
4. **Interception + navigation**: request interception is on and **every redirect hop re-runs step 1's policy** (a public URL 302ing into the private network is the classic SSRF escape — the per-hop re-check exists for exactly that). Subresources pass on http(s)/data/blob; other schemes (file:, chrome:, …) abort. HTTP ≥ 400 is `capture/navigation-failed`; a navigation timeout is `capture/timeout` (default 30s, overridable via `timeoutMs`, clamped to 1–120s).
5. **Quiescence**: after `load`, wait for network silence (no in-flight request for 500ms, capped at 5s).
6. **The scroll sweep**: step down the page by 0.8 viewport, **dwelling 500ms per step** — measured on transformer-circuits.pub: of 102 figures, ~20 render only via IntersectionObserver, and a 120ms/step sweep does not trigger them. The sweep never scrolls back (a virtualizing page could drop off-screen content).
7. **Inline + serialize**, in the live document: matched CSSOM rules resolve by (`!important` → inline-ness → specificity → document order) into element `style` attributes; `var(--x)` resolves along the custom-property cascade (fallbacks, nesting, cycle guard); SVG presentation properties (`fill`/`stroke`/…) are ALSO written as attributes — a downstream whitelist that keeps attributes but strips `style` still sees the colors. Then all `<script>`, `<style>` and stylesheet `<link>` elements are removed (with rules inlined, style blocks are redundant bytes), the document serializes as `<!DOCTYPE html>` + `documentElement.outerHTML`, and output past the cap (default ~8M chars) is cut with `truncated` set.

## Permission model (v1)

**Gesture-gated**: callers invoke `render` only on an explicit user click — that click is the approval. After the first SUCCESSFUL render of a site (by hostname), an allow record persists in `state.json` (first-allowed instant, latest render, count; capped at 500 records, least-recently-rendered evicted) so a future non-interactive caller can be gated on "approved before"; in v1 the record gates nothing. Dangerous targets refuse regardless of any record. Persistence is atomic `node:fs` (temp file + rename) — **not** `ctx.fs` (the session-policy-fenced sandboxed filesystem); an unwritable disk degrades to memory-only, and a corrupt state file reads as empty but is **never overwritten**.

## Threat model

- **Untrusted page content enters the plugin pipeline**: the rendered product is attacker-controlled text and may literally say "ignore your previous instructions". This package's mitigations are the URL policy, the gesture gate, and the output cap; **the prompt-injection surface is the caller's whitelist problem** — the reader runs captured markup through the same whitelist normalization as any fetched page and never renders raw captures. Never treat `render`'s output as trusted content.
- **No login state is carried**: every render is a fresh temporary BrowserContext; credential-bearing URLs are refused; the managed instance is not your daily browser and your cookies are not in it. A login-walled page captures as its login wall — by design, not by defect.
- **SSRF**: private/loopback/link-local/metadata addresses are re-checked after EVERY redirect hop; a resolution failure refuses (an unvalidated host is never navigated to).
- **Process surface**: the pipe transport listens on no port; throwaway profile directories are cleaned at exit (stale ones are swept before the next launch); the binary comes from Google's official Chrome for Testing channel.

## Known fidelity limits

- **Interactive controls freeze**: the serialization is a static DOM — buttons, inputs and expanders lose their behavior (scripts never ship with the product anyway).
- **Headless ≠ pixel-perfect**: fonts, GPU rasterization and some DRM content differ under `--headless=new` from a daily browser; this package does not claim a faithful mirror.
- **Cross-origin stylesheets are unreadable**: the browser refuses their CSSOM (SecurityError); they are skipped and counted — only colors from those sheets are lost.
- **The cascade is approximate**: specificity is a compact hand-computed implementation (`:is()` takes its arguments' maximum, `:where()` is zero), `@container`/`@scope` contents are included unconditionally, `@layer` follows document order; pseudo-element styles (`::before` content and the like) are not inlined. Accurate for the declarations that color figures; not a promise for whole-page layout reproduction.
- **Lazy loading has a budget**: the sweep's total budget is 20s; longer pages capture as far as the budget reached.

## Configuration (the cordis.yml row's `config`)

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
| `extraArgs` | `[]` | Extra Chrome command-line arguments (deployment escape hatch) |

## Install / uninstall

```sh
dsh plugin --profile <name> add @khorsheed/dsh-capture
dsh plugin --profile <name> remove @khorsheed/dsh-capture
```

The package self-mounts (`dsh.bundle.patch` → `cordis.patch.yml`, row id `capture`); `dsh plugin add` reconciles that row into the profile. After removal, callers' probes find no `remote.capture` and behave as if it were never installed (the reader's 「渲染抓取」 gesture disappears whole, without errors). **Note**: a composition must mount the row exactly once.

## Compatibility

| Host line | Verdict |
|---|---|
| npm release (0.1.5-rc.1) | ✅ fully usable (verifiedHost) |
| deepseek-harness master | ✅ same (tracked, never via a local fork) |

The machine-readable twin lives in package.json's `dsh.compat`: the Remote face depends only on the Typert protocol and (for the browser-half mount) api-remotes; a composition without session, fs, or web seams boots all the same — with no Chrome binary every call earns `capture/unavailable`, with no writable disk the allow records stay in memory. The browser half mounts the namespace in any web composition; a headless composition has no `remote` service and the mount skips silently.

## Development

```sh
pnpm install && pnpm run build   # gen-typert → tsc → tsdown (host face first)
pnpm run test                    # vitest: pure tests + real-Context boot + integration
```

The integration suite (`tests/render.integration.spec.ts`) drives a real Chrome against a local fixture server (an IntersectionObserver figure, a CSS-variable SVG, a redirect escape); **it skips wholesale when no Chrome binary exists** (CI has none). Three ways to give the tests a binary: the `DSH_CAPTURE_CHROME_PATH` env var, the managed install under the default state root, or the system `chrome` channel.
