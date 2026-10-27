# Agent Note: the reader fetches feeds and pages through its own official HTTP provider

Status: implemented

## Problem

The reader fetched every feed and article page through `ctx.web.fetch` and relied on getting the origin's document: `classifyPayload` decides feed vs page from the payload head (`<?xml`, `<rss`, `<feed`), the extractor needs HTML, and cross-origin redirect handling reads `WEB_REDIRECT_BLOCKED` plus the final URL. From host 0.2.1-rc.2 the web-search settings switch 「Use the new Web Search API」 writes `web.fetchProvider` along with `web.searchProvider`, selecting `deepseek-fetch-api`, which answers Markdown (`body.kind: 'text'`), a constant 200 and the request URL. Under that switch every feed became a page and no article could be extracted. A fetch request carries only a URL and the web service exposes no provider registry, so a caller cannot ask for the `http` provider (seam registry S22).

## Decision

`src/document-fetch.ts` picks the fetcher per call. When the mounted `web` is the official service (it carries `registerFetchProvider`), the reader fetches through its own `HttpFetchProvider` from `@deepseek-ai/dsh-web-fetch-http` (new optional peer, public since 0.1.5), built once with that row's default limits overlaid by the new reader config `fetchLimits`. Any other `web` shape, or a host without the package, fetches through the seam as before. `ctx.web` stays the permission: with no `web` mounted nothing is fetched. Both call sites (`fetchFollowing`, `resolvePaper`) go through it; the policy and errors are the provider's own, so redirect reconstruction is unchanged.

## Alternatives considered

- **Sniff the seam's answer and re-fetch when it does not look like markup**: rejected. The `http` provider also answers `kind: 'text'` for feeds and JSON, so the test is a heuristic, and under the switch every page would cost a paid Fetch API call before the re-fetch.
- **Read the web service's configured provider id**: rejected. `WebRuntime.config` is private, and reading it ties the reader to internals.
- **Extend `image-fetch.ts`'s hardened direct fetch to documents**: rejected. It would duplicate the official provider's charset decoding, redirect policy and error vocabulary, which the reader's classification already depends on.

## Consequences

- Feeds and articles keep working with the switch on; the reader never spends a Fetch API call.
- Limits raised on the `web-fetch-http` row no longer reach the reader; deployments set `fetchLimits` on the reader row instead (`packages/reader/docs/reference.md`, both languages). 3080 had raised that row's limits in its startup patch, so they stopped reaching the reader; [the body-cap note](../feature/2026-10-27-reader-fetch-body-cap.md) restores whole pages with a 2 000 000 default.
- A user who picked a different fetch provider on purpose (for example a proxying one) no longer has it applied to reader fetches.
- Retire when the seam lets a request name its provider (S22).

## Testing

`tests/document-fetch.spec.ts` (7 cases) pins: no `web` means no fetcher; a plain `{ fetch }` seam is used as is and the package is never loaded; on the official service a Markdown-answering seam is bypassed and never called; the provider is built once with the defaults and the configured limits; an absent or throwing package falls back to the seam; the real `@deepseek-ai/dsh-web-fetch-http` loads and refuses a loopback target under its own policy. Package suite green on host 0.2.1-rc.3.
