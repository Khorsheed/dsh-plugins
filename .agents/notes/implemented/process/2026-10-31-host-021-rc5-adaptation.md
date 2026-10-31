# Agent Note: host 0.2.1-rc.5 adaptation — reasoning display without plugin migration

Status: implemented

English | [中文](2026-10-31-host-021-rc5-adaptation.zh.md)

## Problem

The rc4 adaptation was complete but had not yet reached production or npm when the host published rc5. The release decision needed an exact rc5 source baseline and a fresh compatibility result rather than either two redundant release waves or an assumption that rc4 evidence also covered rc5.

## Decision

Track `dsh-v0.2.1-rc.5` at `b830ec950faba0a46dda564be3e2d854afed94f1` in the development graph and both fixed workflow harnesses, and combine rc4 and rc5 into one deployment and release wave.

Apart from release metadata, rc4 to rc5 changes reasoning display. `ReasoningBodyOwnerProps` now carries both `rawText` and display-ready `text`; the Content Factory contract is unchanged. No community package consumes that Body slot or constructs its owner props, so no plugin source migration, minimum-host increase, newly unblocked package, or compatibility-path retirement follows from this delta. Reader's own HTTP provider, file-preview mentions, and mobile's legacy View CSS remain necessary for their supported host ranges. Local-agent's independently rendered reasoning is not silently claimed to inherit the official signature filtering; no current evidence establishes a defect there.

## Alternatives considered

**Deploy and publish rc4 first, then repeat for rc5.** Rejected: the complete rc5 delta is small, no community consumer needs a migration, and one production observation window and npm wave cover both without mixing their test evidence.

**Copy the official reasoning cleanup into every community display.** Rejected for this compatibility wave: the official Body contract has no community consumer here, local-agent owns a separate display path, and context-lens intentionally exposes diagnostic source text. A product behavior change would need its own reproduction and tests.

**Reuse rc4's green gate.** Rejected: cross-host acceptance clears TypeScript caches and forces type generation against the exact rc5 source checkout.

## Consequences

Only the host pins, regenerated lockfile, CI references, and this record change. The rc4 source-adaptation history remains intact. Production deployment and npm publication still require their own gates; the compatibility verdict does not advance `verifiedHost` by itself.

## Testing

`pnpm gate --all` passed all 17 steps against the exact rc5 checkout after clearing TypeScript caches and forcing type generation: all package builds and tests, 401 script tests, document and hygiene gates, and 42 verified package tarballs. The official rc5 build passed all nine build gates. Its assembled-Web reasoning browser test passed for both plain and signature-prefixed streams, including expanded content and the absence of signature metadata.

## Related

- [Host 0.2.1-rc.4 adaptation](2026-10-27-host-021-rc4-adaptation.md)
