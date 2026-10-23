# Agent Note: The invite picker's model list follows the harness's curated shortlist

Status: implemented

## Problem

The room's invite-member dialog showed the endpoint's whole served catalog (every model the endpoint lists), while the member configuration dialog shows the curated「可用模型」shortlist (models.json). Two surfaces for the same choice disagreed; the user reads the shortlist as THE available set, so the invite list ignoring it read as a bug.

The member dialog's scoping lives in each provider's broker (`scopeServedDirectory`, member branch). The invite picker's directory is the memberless broker call — shared with the settings card's add-model dialog, which needs the full catalog to build the shortlist, so the memberless surface could not just change.

## Decision

The picker's directory face scopes the served directory to the curated list (`scopeDirectoryToList`, `client/model-directory-scope.ts`), applied in the face's read/follow (`client/index.ts`): the list's order leads, a listed value the endpoint no longer serves stays as a bare row (the member dialog's convention), and no list (or an empty one) keeps the served catalog. The picker component itself is unchanged — the face is its only data source and `renderHarnessModelPicker`'s only consumer is the room's invite dialog.

The settings card's add-model dialog keeps the full catalog (it reads the memberless broker directory through a different face) — you build the shortlist from everything, then everything else follows the shortlist.

## Alternatives considered

- **Scope host-side** (a surface knob on the `modelDirectory` Remote honored by each provider's broker). The member dialog already scopes in the brokers, so this would have been the consistent architecture — but it touches the gateway contract plus every provider's broker for a transformation both already-exposed Remotes (`modelDirectory` + `modelList`) support on the client. The face-level scope is fifteen lines and no contract change.
- **Scope inside the picker component.** Same size, but the picker file was being rewritten in flight (the room-members-extension stack adds effort there) — scoping the face keeps the merge surface minimal for that branch: only the face's read/follow move.

## Consequences

- Inviting an external member offers exactly the curated shortlist (its first entry becomes the dialog's default, matching the card); without a shortlist the picker behaves as before.
- A shortlist value the endpoint stops serving stays pickable as a bare row — deliberate (the member dialog shows it identically); a member invited on it will fail at spawn with the endpoint's own error.
- Merge note for the in-flight effort work (room-members-extension stack): the shortlist scope lives in the face construction (`client/index.ts`) and the new `model-directory-scope.ts`; their picker's effort props are untouched by this change.

## Testing

`pnpm --filter @khorsheed/dsh-local-agent test` (38 files, 400 tests), including the new `tests/model-directory-scope.spec.ts` covering list order, resolvedModel aliasing, bare rows for unserved values, and the null/empty-list passthrough.
