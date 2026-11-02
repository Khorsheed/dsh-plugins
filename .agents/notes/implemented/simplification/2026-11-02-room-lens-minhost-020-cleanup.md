# Agent Note: Room and Context Lens drop their 0.1.x host branches at minHost 0.2.0

Status: implemented

## Problem

The user raised the minimum host of room and Context Lens to 0.2.0. Both packages still carried read paths for hosts older than that, and with the new floor those paths can no longer run:

- room's preset-registry probe fell back to the pre-0.1.7 package name `@deepseek-ai/dsh-agent-presets`, and `deriveSessionPreset` fell back to the rc-era `resolveSessionPreset`. 0.2.0-rc.1 ships `@deepseek-ai/dsh-agent-preset-registry` with `agentPresetProjectionDefinition`.
- room's composer read the 0.1.5 session-snapshot `queue` when the `inbox` projection was absent, and guarded `useProjection === undefined`. In 0.2.0-rc.1 every session-scoped slot receives `useProjection` as a required prop, and the queue lives only in the `inbox` projection.
- Both packages' `mainSessionId` fell back to `SessionListState.current`, and both `presetOf` fell back to a top-level `agentPreset` row key. The 0.2.0-rc.1 `SessionListState` has no `current`, and its `SessionSummary` carries the preset only as `projectionValues.agentPreset`.
- room's model picker and member editor treated any non-Result resolution of `ModelDirectory.select` as success (0.1.5 resolved void). In 0.2.0-rc.1 `select` returns `Promise<RemoteResult<void>>`.
- room's `isRoomSource` accepted the released V3 wrapper `{ kind: 'plugin', plugin: '@khorsheed/dsh-room' }`, which a pre-V4 host served verbatim.
- Context Lens kept a `view.wireHint` string ("requires host ≥0.1.2") with no reader.
- room still exported `taskProgress` and `RoomTaskProgress`. Only one spec used them.

## Decision

- `engines.dsh` is `>=0.2.0-rc.1 <0.3.0-0` and `dsh.compat.minHost` is `0.2.0-rc.1` in both packages. The host evaluates the range with `includePrerelease`. The READMEs, the room reference doc and the compat notes say the same.
- room imports only `@deepseek-ai/dsh-agent-preset-registry`. When the module is missing, the probe still settles to `null`, which means no preset. The old package name is gone from room's peer, peer-meta and dev dependencies.
- `PresetDerivationSurface` keeps only `agentPresetProjectionDefinition`.
- The composer reads queued rows only from `inbox.next-turn`, and the todo strip and stats row render unconditionally. `LegacyQueuedMessage`, `EMPTY_LEGACY_QUEUE` and the `useProjection` guards are deleted.
- `mainSessionId` (room and lens) reads only `retainedBy.mainView`, and `presetOf` (room and lens) reads only `projectionValues.agentPreset`.
- room's client `Context` is narrowed to the browser `ISessions` face (`RoomClientContext`), so its `list`, `scope` and `binding` reads do not resolve to the host `SessionStore` that shares the same Context key. This is a type-only distinction; runtime behavior is unchanged.
- `RoomModelDirectory.select` is typed `Promise<RemoteResult<void>>`. The picker and the member editor test `result.ok`, and a rejection still counts as a failure.
- `isRoomSource` accepts `room` and `plugin:@khorsheed/dsh-room`. In 0.2.0-rc.1, `JsonlSessionPersistence.open` loads a historical file through `requireStoredLog`, which runs the V3→V4 migration (`session-format-v3-to-v4`'s `rewriteV3MessageSource` → `rewritePluginSource`) before either a read handle or a write handle is served. A V3 wrapper therefore never reaches room's live session or the `inspectCold` read handle, and V4 durable admission refuses the wrapper on write (pinned by `persistence.host.spec.ts`).
- `view.wireHint` and the `≥0.1.2` wording in SegCtl's comments are deleted. The comments in room that described old host lines now describe current behaviour only.
- `taskProgress`, `RoomTaskProgress` and their spec are deleted.

## Alternatives considered

**Keep the fallbacks as harmless dead code.** Rejected: each one tells the next reader that a 0.1.x host still matters, and the tests that pinned them kept old shapes alive in fixtures, for example `current` on session-list doubles and `queue` on session snapshots.

**Also delete the `room/task-*` replay and `RoomState.tasks`.** Deferred. The three event types must stay registered, because a log that holds them would otherwise fail to load. `RoomState.tasks` is a required field of the `getState` typert codec, so removing it changes the Remote surface. No client reads `.tasks` (the client task views read `plan.tasks` and jobs). That cleanup belongs to the export-narrowing batch.

**Remove the repo-wide dual-shape typert codecs (`scripts/gen-typert.mts` `dualShapeCodecs`).** Out of scope. They apply to every typert package, not just these two. Only room's compat note stopped citing them.

## Consequences

- On a host older than 0.2.0-rc.1, the loader refuses both packages by their engines range instead of running fallbacks that nothing tests.
- The published `./types` face no longer exports `RoomTaskProgress`. Nothing in this repo imports it.
- Session-list and composer test doubles now model the 0.2.0 shapes: `retainedBy.mainView` rows, `inbox` projection values and `RemoteResult` selections.
