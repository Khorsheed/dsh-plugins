# Agent Note: file-preview persists verified bash writes in the session log

Status: implemented

English | [中文](2026-11-12-file-preview-durable-bash-writes.zh.md)

## Problem

Bash-written products could disappear from the products view after a host restart because the collector's only truth was a per-session in-memory map. A second `session/created` replay reconstructed that map from tool events. Rebuilding was unnecessary once the host could persist plugin-owned facts, and keeping two sources of truth made the products view depend on process lifetime rather than the session log.

## Decision

Keep the existing high-precision bash extraction and `fs.stat` verification unchanged. Only a candidate verified as a regular file is appended as a versioned `plugin:file-preview/bash-write` containing its path, turn, step and source-call sequence. Failed commands, missing files and unsupported command forms never create a record. A rejected record is a diagnostic/no-op, not a new tool result.

`FilePreviewService.list` and `turnFiles` read and validate those records with `pluginRecordOf`, preserving first-seen order, dedupe and per-turn attribution. They no longer reconstruct an in-memory fact registry on `session/created`. A log with no durable records can still replay its legacy tool events on demand, read-only, so upgrading does not erase older products. Pending command candidates are the only collector-owned per-session runtime data.

The new persistence path moves file-preview to host 0.2.2-rc.2. The record is `ignorable: true`, does not enter the model surface and does not wake an Agent. The official bash tool still does not report its output paths; the collector stays until that upstream fact exists.

## Alternatives considered

**Keep the in-memory registry as the primary truth and mirror records.** Rejected: it would preserve the two-source inconsistency. Durable records are authoritative; legacy replay is only a compatibility read path.

**Infer more write forms to increase coverage.** Rejected: `cp`, `mv`, Python and other uncertain commands can produce false products. The existing conservative set stays unchanged.

**Use plugin records for assistant text or model context.** Rejected: these are filesystem facts for people and views, not prompts or assistant messages.

**Retire the whole collector now.** Rejected: official bash still does not provide write paths. Only the memory fact table is retired; S2 remains open for native bash write metadata.

## Consequences

Products now survive a real JSONL restart without relying on process memory. The normal write/edit fold, content reads, diffs, turn attribution and existing deletion behavior are unchanged. Older logs without records remain readable through the compatibility replay, and malformed records are ignored rather than inventing files.

The minimum host rises only where the new API is required. No production deployment or npm publication is implied by this source change.

## Testing

Passed on rc.2: 24 file-preview test files / 233 tests. Five durable-persistence tests cover stat verification and partial success, real JSONL restart, direct list/turnFiles reads, legacy replay and malformed-record rejection. Existing collector, fold, read and preview tests all pass, including the formal V4 tool-call lifecycle and zero-error browser bundle builds.

## Related

- [Eval lifecycle notifications](2026-11-12-eval-lifecycle-notifications.md)
- [Host 0.2.2-rc.2 adaptation](../process/2026-11-12-host-022-rc2-adaptation.md)
- [Official-capability roadmap](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
- [Upstream seam registry](../../../../docs/upstream-seam-registry.md)
