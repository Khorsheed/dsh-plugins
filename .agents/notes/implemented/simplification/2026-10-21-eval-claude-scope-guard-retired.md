# Agent Note: eval retires the claude container-scope guard

Status: implemented

## Problem

`claudeScopeDiagnostics` (CLAUDE_CONTAINER_SCOPE_MISSING / SHARED) refused claude conditions that shared a scope across the host/container line. Its premise was OAuth: single-use refresh tokens rotated independently from the host keychain and the unit's bind-mounted credentials file, and the endpoint invalidated the token family on rotation — whichever side refreshed last killed the other (measured in production). With the family's endpoint-key auth (2026-10-19 claude-code note, 2026-10-20 family note), an API key neither refreshes nor rotates, so the fork the guard existed to prevent is gone.

## Decision

The guard, its two diagnostic codes, its locale entries, its spec block, and the now-dead `ScopedConditionRef` plumbing are removed. Remaining wording that pointed at `/<harness> login` (the credential-directory error message, the schema description, the dataset-authoring protocol's quoted schema block, README pairs) now speaks of the endpoint credential (`endpoint-auth.json`); the protocol spec's no-drift gate pinned the doc update.

Per-condition `scope` itself is untouched — it still gives a condition its own scoped home (isolation, two keys in one run), it just no longer pretends to protect a credential from rotation.

## Alternatives considered

- **Downgrade the guard to a warning.** Rejected: a warning whose premise no longer exists trains operators to ignore the readiness report; a rule that cannot fire honestly must not pretend it can.
- **Keep the guard for the contract-document era it was written in.** Rejected: the validation runs against TODAY's harness behavior, and today's harness has nothing to fork.

## Consequences

- A claude condition in a unit may now omit `scope` — the instance's default scope shares one endpoint key with the host safely. Existing contracts that name scopes keep validating unchanged.
- Follow-up left open on purpose: the dataset-authoring protocol still says the mounted home is "the one /<harness> login writes into" in one mount paragraph (the sentence's point is the mount, not the login) — sweep it with the next protocol-doc touch.
