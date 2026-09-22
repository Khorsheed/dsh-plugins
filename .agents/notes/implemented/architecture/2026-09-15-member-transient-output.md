# Agent Note: Member transient output through public Conversation extensions

Status: implemented

## Problem

Mirrored external sessions have no native Agent. The host assistant-stream bus requires a real Agent, while frequent full-prefix assistant messages amplify durable history and couple browser latency to persistence. The native sub-DSH wire also forwarded completed events without generation frames.

## Decision

Core owns a transient registry and a streaming Remote. Each viewed session receives a current baseline and ordered suffix patches, with explicit replacements for rewritten snapshots. Slow followers retain only the last delivered state; reconnect starts from the current baseline. The browser shares one subscription per viewed member and closes it when its last live node unmounts.

The producer writes a log-only `local-agent/stream` anchor at the reserved step. Public Conversation definitions render its text using the official Markdown component. Native final assistant messages hide the transient node at the same coordinate; the engine requires a hidden stable node, not withdrawing an already materialized node. Native tools, final content, usage, and navigation remain on their existing paths.

Recovery uses independent one-second checkpoints containing suffix bytes, with explicit replacement for non-prefix updates. This makes ordinary append-only recovery bytes linear in output length. Producer disposal checkpoints the remaining partial. Three external providers use this transport when the core exposes it; compatibility with older core instances retains the snapshot path. The sub-DSH headless process forwards the real Agent's native frames over an additive wire notification. Its parent filters round and attempt identity, assembles text/reasoning with the public BlockAssembler, and preserves an interrupted partial on cancellation.

Claude pairs native message IDs and content-block indexes across partial and completed events; older frames use ordered per-message fallback keys. Kimi separates generations at new ACP tool calls, reserves the tool coordinate before a delayed wire fold, and consumes same-kind segments in order. ACP does not provide a universal text-item identity, so this is a boundary-based fallback rather than an invented vendor ID.

## Alternatives considered

**Spoofing the native Agent stream bus.** Rejected because a mirrored Session is not an Agent and cannot satisfy the host ownership contract.

**Writing every display batch as a complete durable message.** Retained only as an older-core fallback. It produces quadratic prefix bytes during a long response and prevents independent persistence cadence.

**Mutating the browser Session's event source.** Rejected because the public Session face is read-only for history; exported implementation classes do not authorize mutation of another service's owned state.

**Replacing the entire transcript view.** Unnecessary: public event definitions and keyed chat renderers provide chronological placement while leaving native final rendering and navigation intact.

## Consequences

No host source changes are required. A connection loss keeps the last rendered partial and reconnects with a baseline. Recovery from a host crash can lose the uncheckpointed tail; the checkpoint node explicitly remains a partial record, never a fabricated completed answer. Checkpoints are log-only and never become model messages. A plugin uninstall hides unfinished custom presentation but leaves native completed transcripts intact.

The 50ms publication scheduler and the separate durability path are implementation primitives, not a measured browser P95 claim. Same-kind provider item identity, complete native content coverage, real browser latency, and fresh-install/upgrade acceptance remain tracked by the larger coordinator proposal. DSH's generation-time presentation joins its text and reasoning blocks; its native final retains the original block structure.

## Testing

Tests exercise baseline/suffix/replacement/removal, slow followers, abort cleanup, reconnect without duplicated text, checkpoint byte growth, finalization timer cancellation, and partial recovery. The real public Conversation assembler verifies live and replay replacement by native final messages. Provider tests cover transient output before completion, native final usage, DSH round filtering, and interrupted partial retention.
