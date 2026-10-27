# Agent Note: the reader fetches whole pages

Status: implemented

## Problem

claude.com's "Expanding Claude for Nonprofits" showed four paragraphs ending in "Co" and the 受限篇幅 note. The page is 620 KB of HTML; the article starts at about 97 000 characters, behind inline script and data, and the fetch stopped at 100 000. Since 2026-10-24 the reader fetches through its own instance of the official `http` provider (seam registry S22), built with that row's defaults, including `maxBodyChars: 100_000`. 3080 used to raise the row to 2 000 000, but the row's config stopped reaching the reader when it began building its own provider, so the raise was lost without anyone noticing.

## Decision

`DOCUMENT_FETCH_DEFAULTS.maxBodyChars` is 2 000 000: the value deployments ran the row at, and what the per-source storage budget `MAX_BODY_CHARS_PER_SOURCE` (2 MiB) is sized for. The row's 100 000 is sized for a page handed to a model; the reader extracts the article itself from the raw HTML, so it needs the whole page. `maxResponseBytes` stays at 5 000 000. A deployment can still override both with the reader's own `fetchLimits`.

## Alternatives considered

**Set `fetchLimits` on 3080 only.** Rejected: every install would hit the same cut on any modern page, and the default would still disagree with the storage budget.

## Consequences

- Articles fetched while the cap was 100 000 keep their partial body until they are fetched again (重新抓取, or the next refresh after the cached body expires).
- Hosts where the reader fetches through `ctx.web` (no official provider package) still get that seam's own limit.
