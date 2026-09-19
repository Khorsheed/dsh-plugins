# Agent Note: Compact Room configuration and coordinator identity

Status: implemented

## Problem

The coordinator pilot exposed inheritance modes, CLI defaults and catalog diagnostics in the main model picker. Users had to understand configuration layers before choosing a model. The native member name `main` also confused identity with the transferable coordinator role, while goal budget labels did not distinguish shared limits from per-member limits.

## Decision

The shared member control uses a compact model/effort menu. Selecting an option submits immediately through the existing core revision controller; running turns retain their captured configuration, and pending changes remain cancellable. Settings keep their Save action. Settings and invitations retain an existing saved model, otherwise choosing the first visible catalog entry. Legacy inheritance modes remain readable in the backend, but are not ordinary menu options. Custom IDs and directory diagnostics are collapsed; candidate provenance remains available on hover. Missing native effort metadata is explained, never replaced with invented choices.

Fresh rooms name the native member `dsh`. Existing journals retain their names so historical addressing stays valid. The coordinator label sits at the top left of the Room composer, independently of member identity. Goal budget labels explicitly state goal-wide concurrency and total executions, executions per task, and active goal time; initial dispatches, retries and rework consume attempts, ordinary chat does not.

## Alternatives considered

**Keep the detailed configuration form.** Its inheritance and CLI-default vocabulary explains implementation layers rather than the user's model choice. Those semantics stay behind the compatibility boundary.

**Rename existing members on replay.** This would change historical `@main` addressing and recorded task ownership. Only creation defaults change.

**Populate a fixed effort list.** Provider/model capabilities differ; configured-only Kimi catalogs can lack native effort metadata until a runtime is prepared. The UI reports that absence.

## Consequences

Room and member composers share immediate selections and next-turn semantics without owning another queue. Provider settings retain explicit saving, and old cores can still use their legacy invite fallback. This UI change neither grants Room to additional presets nor copies the isolated acceptance preset into production. Browser acceptance is performed on the isolated instance; production deployment remains separate.
