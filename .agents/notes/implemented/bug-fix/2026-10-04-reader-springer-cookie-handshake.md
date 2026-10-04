# Agent Note: The reader treats Springer Nature's cookie handshake as a wall the rendered fetch walks through

Status: implemented

## Problem

A Springer article (`link.springer.com/article/10.1140/epjds/…`, open access) showed 「这个地址需要登录（机构代理或单点登录）」. The article is not behind a login. Measured 2026-10-04:

- A cookie-less request gets a 303 to `idp.springer.com/authorize?response_type=cookie&…`. That endpoint mints a one-time code, goes through `/transit`, and sends the browser back to the article with `?error=cookies_not_supported&code=…`, which then answers the full text. `www.nature.com` does the same through `idp.nature.com`.
- The host's `web-fetch-http` does not follow cross-origin redirects. It reports only the target origin, and plugin fetches keep no cookies. So the plain fetch can never finish the handshake, and requesting the bounce-back URL directly just starts a new handshake.
- `classifyFetchFailure` read the `idp` host name through `LOGIN_HOST_PATTERN` and filed the hop as `login`. That code never escalates to the rendered fetch.
- The headless browser (capture, system Chrome) read the full article in about 36 s: correct title, all sections.

The same card also appeared twice in the state, under one id (`link-1v6imqy`, 0.7 s apart). `addSource` checks for a duplicate before its fetch, so a second click on 「添加」 passed the same check while the first fetch was still running, and both commits prepended the source.

## Decision

- `COOKIE_HANDSHAKE_HOSTS` (`idp.springer.com`, `idp.nature.com`) and `isCookieHandshake(message)` live in `src/types.ts`, shared by host and client.
- `classifyFetchFailure` files a cross-origin hop into one of those hosts as `blocked`, before the login-host check.
- The client's `browserSolvable` and `describeFetchFailure` accept the handshake message. Opening such an entry with capture mounted auto-renders it, like the WeChat wall.
- The state normalizer re-files a stored `login` failure (source `failure` and entry `failureCode`) whose message is the handshake as `blocked`. Links saved before this fix recover without being re-added.
- The add commit goes through `withNewSource`, which re-checks id and URL inside the commit and makes the add idempotent. `normalizeStateDoc` keeps the first source per id, which clears duplicates already on disk.

## Alternatives considered

**Walk the handshake hop by hop from the host.** The seam names only the target origin, not the full `authorize` URL, and keeps no cookie jar. Requesting `…?error=cookies_not_supported` directly answers another 303 (measured). It cannot be done without a host change.

**Treat every `idp.*` hop as browser-solvable.** `idp` is also the usual name of a real institutional identity provider. A headless browser without the reader's session meets a real login too, so the table stays explicit and measured.

**Fetch the open-access full text from Europe PMC.** It has no record of this article (measured), and it would cover only part of Springer's catalogue.

## Consequences

- Springer and Nature articles need the capture plugin. Without it the card says 「被拦截」 rather than 「需要登录」, which is now accurate.
- A paywalled Springer article renders as its abstract page. The rendered fetch gets what a cookie-less browser sees, no more.
- A new handshake host is a new row in `COOKIE_HANDSHAKE_HOSTS`, measured before it is added.
- Tests:
  - `tests/host-pure.spec.ts`: handshake classified `blocked`, unknown `idp` not; stored `login` re-filed, real login kept; one source per id.
  - `tests/boot.spec.ts`: two racing adds file one source.
  - `tests/ReaderPane.client.spec.tsx`: auto-render on a Springer handshake.
