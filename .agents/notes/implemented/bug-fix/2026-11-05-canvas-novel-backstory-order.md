# Agent Note: Backstory imports join story time and events can move backwards

Status: implemented

## Problem

Chapter reconciliation treated an event without a valid `after` as the next event in the chapter. A childhood event recalled in chapter 1 therefore landed after the opening scene even when `backstory=true`; the flag changed only its display group. The write API could append or place an event after another, but could not repair an event that belonged earlier. A backstory explicitly placed among current events also became the implicit anchor for later unanchored backstories, and the UI still showed it in “before the opening,” contradicting its stored order.

## Decision

- An imported backstory without `after` joins the ordinary, pre-opening backstory group in payload order. A backstory explicitly moved into the current-event region is not an anchor for that default. Current events keep their chapter order and never use a backstory as their implicit chapter anchor.
- A valid explicit `after` always wins. An unknown import anchor drops the event with `id-not-in-ledger` instead of silently placing it at the end.
- `novel_write(what=event)` accepts `before`, naming an existing event or `first`, mutually exclusive with `after`. Both APIs reject unknown or conflicting positions. A new manually written backstory without a position uses the same backstory default; editing an existing event without a position preserves its order.
- `orderBefore` and `orderBackstory` live with `orderAfter` in the pure timeline module. Existing books need no migration.
- Explicit position controls both storage and display. A backstory placed among current events keeps its factual backstory label but renders in 正文 at that order; only the ordinary pre-opening region renders under 故事开始前. The Remote view carries `order` so the client can make that distinction without inferring chronology.

## Alternatives considered

- **Keep backstory as display metadata only.** Rejected: the persisted story-time order remained wrong in every consumer, and each new flashback added another repair for the person.
- **Infer chronology from `when` or chapter numbers.** Rejected: `when` is a label, not a calendar, and the chapter that tells a backstory is not when it happened. The default is deliberately deterministic; explicit positions handle known chronology.
- **Clear the backstory flag when an event moves into 正文.** Rejected: placement is the person's ordering choice, not proof that the event no longer predates the opening. Order controls the group while the flag preserves the fact.
- **Keep the old fallback for unknown anchors.** Rejected: silently appending malformed model output hides the error and corrupts story time. The import report now names the rejected anchor.

## Consequences

- Mixed chapters preserve two independent orders: current events follow their appearance in the chapter, while unanchored backstories retain their payload order within the ordinary backstory group. Re-reconciliation still replaces that chapter's extracted events; a later unanchored backstory belongs in a subsequent import, not an implicit append to a rewritten chapter.
- The default does not claim to know whether a newly discovered backstory predates existing backstories. `after` and `before` carry that information when the text supplies it.
- Existing manually corrected event positions stay unchanged. No data migration runs.
- Tests cover chapter 1's interleaved current events and backstories, an explicitly positioned backstory followed by an unanchored import in another chapter, storage/display agreement, moves to the opening and before another event, and invalid anchors.
