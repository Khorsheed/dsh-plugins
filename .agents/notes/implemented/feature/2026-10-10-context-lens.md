# Agent Note: Context Lens request and timing workbench

Status: implemented

## Problem

The request inspector exposed captured data but made cache regressions, repeated prompt content and expensive tool interactions difficult to compare. The approved prototype also revealed inconsistent duration rounding and mixed parent/child totals.

## Decision

The package, directory, bundle row and sidebar kind are renamed to `context-lens` (`@khorsheed/dsh-context-lens`). The `requestInspector` service and Remote namespace remain stable for scoped-read consumers. This is an installation identity change: an existing deployment must replace the old direct dependency and bundle row; mounting both packages would register the same service twice. This change does not publish to npm.

The retained visual style uses bordered metric cells, mono numbers and the prototype's timing palette. A turn stepper and latest button synchronize the conversation scroll. A horizontally scrollable, draggable session map shows input/cache data for each retained request; `getSessionTrend(sessionId, filter)` returns only request headers and inherits scope filtering, retention and generation metadata.

Request detail is ordered as measured cache usage, this exchange (new input beside captured output), then context composition. Full-text duplicates of at least 40 characters can be filtered. Message rows expose explicit tool errors and the originating session-event turn where known. Long output and reasoning are collapsed and remain scroll-bounded when opened; argument values expand independently.

Prefix comparison uses exact retained segment content in the same scope, including across turns. Appending messages preserves the prefix; replacement/removal or tool-schema changes remain visible. Prefix differences describe assembly facts, not a claim about the provider's cache invalidation cause. Without a retained predecessor the comparison is unavailable.

Timing cards and both tables describe one selected agent. All agents stay visible on separate clickable timeline lanes. Model-internal residuals and between-request gaps are separate. Tool reasoning is allocated equally among calls from that request, parameter time follows its tool lane, and execution errors use explicit `isError`. Concurrent intervals share elapsed time across active spans, with an explanatory note, keeping cards and tables additive. All duration labels retain tenths of a second.

## Alternatives considered

**Another visual redesign.** Rejected by the user after reviewing the prototype; retain the earlier visual direction.

**Model-generated findings or host changes.** The user requested observable data only and no upstream changes. Exact comparisons and provider usage meet that scope.

**Summing parent and child timing.** Delegation already includes child execution, so that would count the same time twice. Agent-specific accounting preserves the distinction.

**Guessing errors from tool prose.** Error totals consume the host flag; Canvas fixes its own declared failures through the host's thrown-error path instead.

## Consequences

The new installation identity requires migration before production replacement. Old saved sidebar kinds may show the host's unavailable fallback. Capture is still pull-based and bounded by the existing retention budget; uncaptured or evicted data is not invented. A prefix preview is short, while the full request remains expandable.

Regression coverage pins overlap accounting, the two-table identity, source turns, content changes with stable message IDs, scope-filtered trend reads, Remote descriptor arity, navigation and output expansion. The actual components are visually checked at desktop and 390px widths using synthetic fixtures.

Acceptance on the merged main baseline `84399e6a`: all build and test stages passed, including 137 Context Lens tests, 620 Canvas tests and 325 script tests. The final whole-repo pack gate is blocked: full `gen-typert` incorporates game’s `MessageSourceMap` augmentation (`packages/game/src/hooks.ts`) into Canvas `lib/typert.host.js` diagnostic declarations. The literal `@khorsheed/dsh-game` is then rejected as an undeclared family edge by `verifyTarball`. Reproduce with `pnpm gate`; failure is step 16, packing Canvas. This needs the game/shared-build owners to resolve the full-generation metadata contamination or its verification semantics, rather than adding a false runtime dependency to Canvas. Scoped generation/build of Canvas and Context Lens followed by `pack-all-dist --only canvas,context-lens` passes both tarball verifications. Keep this branch out of main until the whole gate is green.

Production migration is also pending: `deploy:3080` has an add/update path but no rename replacement option. The supported flow must replace the old dependency, bundle roster and override pin before starting Context Lens; do not hand-edit the shared profile or mount both identities. No deployment, restart, npm release or remote push was performed.
