# Agent Note: Backstory imports join story time and events can move backwards

Status: implemented

## Problem

Chapter reconciliation treated an event without a valid `after` as the next event in the chapter. A childhood event recalled in chapter 1 therefore landed after the opening scene even when `backstory=true`; the flag changed only its display group. The write API could append or place an event after another, but could not repair an event that belonged earlier.

## Decision

- An imported backstory without `after` joins the existing backstory group in payload order. The first backstory goes before the opening scene; later ones append to that group. Current events keep their chapter order and never use a backstory as their implicit chapter anchor.
- A valid explicit `after` always wins. An unknown import anchor drops the event with `id-not-in-ledger` instead of silently placing it at the end.
- `novel_write(what=event)` accepts `before`, naming an existing event or `first`, mutually exclusive with `after`. Both APIs reject unknown or conflicting positions. A new manually written backstory without a position uses the same backstory default; editing an existing event without a position preserves its order.
- `orderBefore` and `orderBackstory` live with `orderAfter` in the pure timeline module. Existing books need no migration.

## Alternatives considered

- **Keep backstory as display metadata only.** Rejected: the persisted story-time order remained wrong in every consumer, and each new flashback added another repair for the person.
- **Infer chronology from `when` or chapter numbers.** Rejected: `when` is a label, not a calendar, and the chapter that tells a backstory is not when it happened. The default is deliberately deterministic; explicit positions handle known chronology.
- **Keep the old fallback for unknown anchors.** Rejected: silently appending malformed model output hides the error and corrupts story time. The import report now names the rejected anchor.

## Consequences

- Mixed chapters preserve two independent orders: current events follow their appearance in the chapter, while unanchored backstories retain their payload order within the backstory group.
- The default does not claim to know whether a newly discovered backstory predates existing backstories. `after` and `before` carry that information when the text supplies it.
- Existing manually corrected event positions stay unchanged. No data migration runs.
- The timeline suite covers interleaved current events and backstories, explicit placement, moves to the opening and before another event, and invalid anchors. The full novel suite passes 34 files and 274 tests.
