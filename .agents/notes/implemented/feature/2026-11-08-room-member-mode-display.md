# Agent Note: Member cards and the composer show each member's mode

Status: implemented

## Problem

A room member's mode was visible only inside the invitation/edit flow and the mode-tools diagnostic line. The member list and the composer's current-coordinator trigger named the provider and model, but not the mode. In a writing room, for example, the human could not tell which members were in 写作模式 and which were in another mode without opening each member's editor.

## Decision

The member card's name row now carries a compact chip with the member's full localized mode name, and the composer's coordinator trigger appends the same name after the provider. Members without a mode render no chip or suffix.

The two kinds of members intentionally use different sources. A CLI member reads its invitation-time `member.preset`, which is fixed. The room's native DSH member reads the room session's current `agentPreset` from the reactive session-list projection; its roster `preset` is not a supported native-member field. This keeps the native member honest and prevents it from being mislabeled as mode-less.

`packages/room/src/client/member-mode.ts` owns this selection and the id fallback. Both surfaces also use the existing per-room `modeNames` cache, whose entries already pass through the host's `presetDisplayText` localization. The cache moved earlier in the client apply body so the members face, composer and existing mode-tools notice share it. An unknown id, a pending name read or a failed read displays the raw preset id rather than hiding the mode.

No Remote field, durable event or polling was added. Coordinator changes already flow through `RoomStore`; native preset changes flow through the official session-list projection. The @ menu and coordinator-switch menu are unchanged.

## Alternatives considered

**Add `sessionPreset` to `RoomState.getState`.** Rejected: the browser already has the official reactive projection, so another wire field would duplicate it and still need invalidation. The new display needs no host or persistence change.

**Read `listProviders` independently in each surface.** Rejected: that would duplicate requests and risk different names during loading. The existing cache already serves the mode-tools notice with the correct host-localized copy.

**Show 不带模式 everywhere.** Rejected in favor of preserving the existing compact layout when there is no mode. The feature identifies an active mode; it does not add another permanent label to every card.

## Consequences

- Member names, public roles and mode chips share one row. The mode chip can shrink and ellipsize, with its full name in `title`; narrow cards retain the existing status-chip layout.
- Invitation/edit previews are unchanged because their callers do not pass a resolved mode hint.
- The display describes configuration, not whether the mode's tools loaded successfully. The existing 模式工具 line remains the diagnostic surface for tool availability.

## Testing

- `packages/room/tests/members.client.spec.tsx` renders a native member, CLI members with and without modes, and an unknown preset id; it checks localized names, the room-preset source for native DSH, the id fallback and the absence of an empty chip.
- `packages/room/tests/room-composer.client.spec.tsx` renders an external coordinator in 写作模式, then replaces the room store with a native coordinator and checks that the trigger changes to the room's 开发模式.
- The complete room test suite and package build run through the package's pnpm scripts.
