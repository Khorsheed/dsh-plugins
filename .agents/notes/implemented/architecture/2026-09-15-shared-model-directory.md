# Agent Note: Shared native model directory mechanics

Status: implemented

## Problem

Model pickers reduced native catalogs to identifiers. Codex dropped display labels and reasoning options, did not traverse pages, returned no visible completion notification to an open picker, and replaced successful data with an empty list after a failed refresh. Member reads also used the default scope instead of the delegation's scope.

## Decision

Core owns a rich directory contract and cache with loading, ready, stale, error and unsupported states. Refreshes coalesce, failures retain successful data, invalidation fences late replies, and cancellable subscriptions deliver the initial snapshot and subsequent updates. Providers retain ownership of native protocol and authentication. Configuration and historical suggestions are labelled separately and never replace native metadata.

Codex adopts this cache, preserves hidden candidates and native reasoning options, and traverses all model/list pages. Hidden entries remain absent from the legacy identifier menu. Malformed pages and repeated cursors fail the probe instead of claiming complete enumeration. Completeness describes the source enumeration, not account access or successful inference.

Directory keys include the member scope and cwd, CLI executable identity, and file metadata for scoped configuration, credentials and applicable project configuration. No credential bytes enter keys. An open subscription periodically checks context changes and expiration. Discovery has explicit refresh and streaming Remote methods; the existing model-info read carries the rich directory alongside legacy choices.

## Alternatives considered

**One provider-specific cache per menu.** Rejected because it duplicates stale-data handling and leaves completion and refresh semantics inconsistent.

**Treat recently used identifiers as available models.** Rejected because historical success cannot establish current configuration, account access or native capability.

**Fetch a hardcoded vendor HTTP endpoint from core.** Rejected because native protocol, endpoint and authentication resolution belong to the provider.

## Consequences

This commit establishes shared discovery mechanics and the Codex adapter. Other providers, shared picker UI, execution-time effort control and durable selection admission remain part of the coordinator proposal. Keychain-only authentication changes need provider invalidation hooks; file metadata alone cannot detect them. Manual refresh always remains available. No model turns or credential copies are triggered by directory reads.

## Testing

Core tests cover concurrent cold reads, open subscriptions, refresh failures, retry intervals, invalidated in-flight replies, account separation and empty/error/unsupported states. Codex tests exercise native metadata, hidden entries, pagination, repeated cursors, timeout and subprocess cleanup. Existing package suites remain the compatibility gate.
