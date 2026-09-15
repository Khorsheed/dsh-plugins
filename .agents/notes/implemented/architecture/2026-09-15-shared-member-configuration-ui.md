# Agent Note: Shared model discovery and member configuration UI

Status: implemented

## Problem

Provider settings and room invitations rendered string-only model lists. The member composer disabled model selection while busy, while room edits wrote both a broker override and a roster model, creating two owners and inconsistent failure semantics.

## Decision

Core provides optional client renderers for harness model discovery and member configuration. Settings cards and room invitations use the same directory fields: native labels, full IDs, resolved aliases when supplied, provenance, descriptions, search, custom IDs, refresh and incomplete/stale/error states. Open pickers subscribe to discovery completion. A provider change immediately hides the old provider directory.

Member views and room edit dialogs share one reference-counted configuration subscription per member. They display admitted round configuration separately from prepared and pending selections. Busy members remain configurable; apply, cancellation, retry and optimistic revision conflicts go through the core controller. Frozen evaluations and disconnected controls are visibly disabled. Delayed reads cannot overwrite a newer streamed phase. The member composer retains its independent prompt, Stop and statistics behavior.

Room probes the client service without a runtime import of the local-agent package. Its absence preserves the compatibility controls. For a started member, model ownership stays in core: the room no longer journals a duplicate model after the configuration request. A model-only successful compatibility edit closes without submitting an empty metadata mutation. Unstarted members retain their roster creation configuration.

## Alternatives considered

**Replicate the menu in each provider and room.** Rejected because directory provenance and busy-state semantics already diverged.

**Treat accepted selections as observations.** Rejected. The panel labels prepared and current-round configuration; a native model acknowledgement still does not prove which model served a generation.

## Consequences

The shared control is available to later coordinator routing. Native room main-agent control, frozen evaluation callers, coordinator lifecycle and authenticated browser acceptance remain in progress. No production profile or credentials changed.

## Testing

Core client tests cover busy selection and cancellation across two rendered entry points, stale-draft conflicts, frozen conditions, delayed read races, asynchronous discovery and provider identity changes. Room tests cover shared rendering and removal of duplicate/empty metadata writes. Package builds and full scoped suites are the commit gate; real browser latency and authenticated runtime acceptance remain separate milestones.
