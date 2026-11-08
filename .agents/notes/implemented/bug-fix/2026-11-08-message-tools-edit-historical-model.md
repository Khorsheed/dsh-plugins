# Agent Note: message edits recover their own historical model

Status: implemented

English | [中文](2026-11-08-message-tools-edit-historical-model.zh.md)

## Problem

The message editor's model chip displayed the session's current `ModelDirectory` selection. Editing an older message could therefore silently resend on a different model, commonly the default DeepSeek route. In a room coordinated by an external CLI member, the same native chip was more seriously misleading: room routes the edit trigger to that member, so the native selection did not control generation at all.

## Decision

The `messageTools.editModel` Remote reads the target message's actual native model evidence without changing the log. It examines the first model step after the target and before the next human message, pairing its assistant message with the applicable request header; a matching earlier header covers unchanged routes across turns, and a header inside a failed step still records the attempted route. Missing or contradictory evidence returns `null`, never the current default.

The editor holds the recovered route as a draft. Opening and cancelling do not mutate the session. Saving awaits the shared `ModelDirectory.select()` validation before the edit RPC, and a rejected selection blocks both replacement and regeneration. A `null` result renders no chip and performs no native selection write. External CLI rooms consequently keep their existing `routeEdit` dispatch and the member's current model configuration. The original model-chip decision in [the message-tools implementation note](../feature/2026-08-15-message-tools-edit-withdraw.md) is amended accordingly.

## Alternatives considered

**Keep using the session's current or last-used model.** Rejected: both are global to the session, not the edited message, and old messages can predate either value.

**Select the historical route as soon as editing opens.** Rejected: cancelling would still change the session, and a display-only change would be even less honest. Selection is part of saving the edit.

**Add a one-edit model override to room and local-agent, or reinterpret the CLI model as a native `ModelSelection`.** Rejected for this fix: these are different route vocabularies and would require a new cross-plugin write path, historical member-configuration semantics, and per-delivery overrides. Hiding the ineffective native chip preserves the existing member-owned behavior without inventing that contract.

## Consequences

Native edits now default to the provider, model, and effort that actually handled the target message, including older and previously edited messages. The user can still choose another route, with the choice taking effect only on save. External CLI edits do not claim to restore the member's historical model; they use the member's current configuration, matching the room composer.

The package's 14 test files and 246 tests cover per-message route recovery, unchanged headers, failed steps, no-evidence degradation, draft-only selection, save ordering, rejected selection, and external CLI behavior.
