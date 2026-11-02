# Agent Note: Room and Context Lens agree on dispatch, cancel and rename facts; two local-agent family hazards removed

Status: implemented

## Problem

An architecture inventory of the local-agent family, room and Context Lens found the room ↔ lens event contract written twice — once by room's types, once by the lens's structural reader — and drifting:

- Context Lens anchors each room round on the human's `user/message` and reads `room/dispatch.messageId`, but room never wrote that field. The lens matched the dispatch text over the previous 12 events and fell back to the nearest user message, so an edited or repeated message could anchor the wrong row.
- room writes `room/run-state` with `state: 'cancelled'`. The lens mapped every state other than `done` and `failed` to `running` and recorded an end time only for those two, so a cancelled run read as running and its request window stretched to the member's next run or to now.
- `room/member-updated` addresses a member by its current `name` and carries a new name in `rename`. The lens required an `id` the event never has, so renames never reached round labels.

The same inventory found two hazards in the local-agent family:

- `local-agent-kimi` deleted the presets `standard-kimi`, `code-kimi`, `minimal-kimi` and `kimi` from the user preset root on every startup, a pre-release cleanup for variants last bootstrapped in August. A preset the user created under one of those names disappeared on the next boot.
- Providers resolve `live` as `vol(config.live) ?? true`, but all four settings cards fell back to `false`, so an unset or not-yet-loaded snapshot showed the switch off while members ran live.

## Decision

- room writes `messageId` on both human dispatch paths (a new message and an edited one). `RoomDispatchEvent.messageId` is optional and documented as the message itself, distinct from `task`, which names the task root: a follow-up filed under an open task carries that task's first message as `task`. A human dispatch without a message (a late question answer) omits it.
- Context Lens's `humanMessageBefore` returns a recorded `messageId` as given and keeps the text match only for journals older than this change.
- Context Lens maps `cancelled` to a scope status of its own (`'running' | 'ok' | 'failed' | 'cancelled'`). Only a terminal edge (`done`, `failed`, `cancelled`) ends a run, from its `elapsedMs` when present and otherwise from the edge time; the first terminal edge wins, because a restart's `failed` is followed by `cancelled` when the human moves on.
- Context Lens applies `room/member-updated` with `rename` by finding the member whose current name matches `name`.
- `local-agent-kimi` no longer runs the preset cleanup; `preset-tools.ts` and its spec are deleted.
- The four provider settings cards default `live` to `true`, matching the provider.

## Alternatives considered

**Anchor rounds on `room/dispatch.task`.** Rejected: `task` equals the message id only when the message starts its own task. Filed follow-ups carry the root message of the task they join, which would anchor them on the wrong message.

**Map `cancelled` to `ok` or `failed` instead of adding a status.** Rejected: neither is true, and `failed` would show the failure card for a run the human stopped on purpose. The client compares against `failed` and `running` only, so a fourth value renders as a quiet ended run without UI changes.

**Keep the Kimi preset cleanup but restrict it to presets the plugin created.** Rejected: nothing marks a preset as plugin-created, and the variants have not been written since August, so the cleanup has nothing left to do except delete user presets.

**Share one typed contract module between room and Context Lens now.** Deferred to batch 4 of the consolidation proposal: Context Lens deliberately has no package dependency on room, and the typed-contract work covers more events than these three. This change fixes the observed drift first.

## Consequences

Room rounds written after this change anchor on the exact human message; older journals behave as before. A cancelled member run appears as ended at its cancel time and no longer absorbs later requests. Renamed members show their new name in rounds and handoffs. Users can name a preset `kimi` again. The live switch reflects the provider's real default.

Context Lens still reads room events structurally, so the next field that changes shape on one side can drift again until the shared contract work lands.

## Testing

- `packages/room/tests/jobs.host.spec.ts`: each human dispatch carries its own `messageId`, and a model-filed follow-up's `task` is the first message.
- `packages/context-lens/tests/room-rounds.spec.ts`: a recorded `messageId` wins over a text match; a cancelled run reads `cancelled` and ends at its cancel edge; a rename by name relabels the member.
- `packages/local-agent-kimi/tests/settings-card.client.spec.tsx`: an unset `live` shows the switch on.
