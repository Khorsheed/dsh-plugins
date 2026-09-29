# Agent Note: reader image rescue — host-side fetch for CORP-blocked figures

Status: implemented

English | [中文](2026-09-29-reader-image-rescue.zh.md)

## Problem

In the reader's article view (灵感空间), some figures render as the browser's broken-image icon with their alt text — e.g. every figure on `https://claude.dev/blog/automating-eval-design-and-hillclimbing/`. Extraction was never the broken layer: relative `/media/…` srcs absolutize correctly and the URLs answer 200 to any direct fetch. The block is the response header `cross-origin-resource-policy: same-origin`, which the **browser** enforces on cross-origin, no-cors `<img>` embeds (`ERR_BLOCKED_BY_RESPONSE`) after receiving the bytes. The reader's existing `referrerpolicy="no-referrer"` cannot help — CORP is not referer-based — and no markup change inside `dangerouslySetInnerHTML` can lift it. Only a host-process fetch bypasses CORP.

## Decision

Rescue-on-error through the host (`packages/dsh-reader`): only images that already failed in the browser are re-fetched host-side; healthy images never touch the proxy.

- New `src/image-fetch.ts` — `fetchImageBytes(url)`: http(s) only, no credentials, localhost-name refusal, public-address validation with the connection **pinned** to the validated DNS answers via a custom `lookup` (closes the DNS-rebinding window), per-hop redirect re-validation (max 3, mid-flight refusal of private targets), 2xx + `image/*` content-type checked before the body is read, 8 MiB cap, 15 s timeout. Plus `ImageFetchCache`, a 32 MiB byte-bounded LRU so a sidebar remount (which re-fails every blocked image) is a memory read.
- New `@Remote('fetchImage')` verb on the reader's existing authenticated Remote face — deliberately **not** a `webServer` HTTP route, which would be a new unauthenticated surface.
- `ReaderPane` catches `<img>` errors via `onErrorCapture` (img errors don't bubble), dedupes per mount, marks rescued elements (`data-reader-rescued`), and re-points them at `data:<mime>;base64,…`. An older host build answers an error and the image simply stays broken — degrade, don't explode.

## Alternatives considered

**Proxy every image through the host.** Rejected: doubles traffic and latency for the common case (most article images load fine direct); rescue-on-error pays the proxy cost only where the browser already failed.

**Fix the markup (srcset resolution, referrer tweaks).** Impossible here — the URLs were already absolute and correct; CORP enforcement happens at response time regardless of markup.

**Ride `ctx.web.fetch`.** Structurally impossible: that seam's decoded body is a closed `html|text` union and its provider refuses binary with `WEB_UNSUPPORTED_CONTENT_TYPE` (verified in the harness source). Extending it with a binary body kind is an upstream-proposal candidate.

## Consequences

Blocked figures now render; the price is a second egress path outside `ctx.web.fetch`, hardened at image scope. The public-address classifier is a copy of `packages/capture/src/url-policy.ts` (cross-plugin imports are forbidden) — a shared internal home is the recorded follow-up. New tests cover the policy refusals (asserting zero network hits), the transport against a loopback fixture, the cache, and the pane's rescue/no-storm behavior.

## Testing

`pnpm --filter @khorsheed/dsh-reader build` and `test` green (445 tests, including the new `image-fetch.spec.ts` and pane rescue cases) against the pinned 0.2.0-rc.2 checkout; live fetch of the exact broken figure from the report verified over the real network.
