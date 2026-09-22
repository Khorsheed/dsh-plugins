# Agent Note: Bind room coordination tools to authenticated members

Status: implemented

## Problem

External coordinators could receive room input but their member bridge exposed only a confirmation-gated message tool. They could not inspect the room or invite workers. A throwing room gate also fell through to family direct execution, bypassing the room's decision.

## Decision

The member bridge exposes room_read, room_invite and room_message. The host resolves each caller from its registered token and requires an active configuration round; idle, expired and preparation tokens cannot issue room commands. Room validates the child/provider against its roster. Tool arguments cannot set the sender or parent room. Only the current coordinator may invite or dispatch; members may read bounded room context.

Native DSH and external coordinators use the same room service for invitations and background messages. The native companion adds room_read through a capability probe and uses the shared context reader. Former native coordinators cannot invite, dispatch or mutate the legacy shared task board after handoff. Coordinator-originated member_message also uses room dispatch. Worker ad-hoc relays retain the existing confirmation gate; durable execution completion reports remain automatic.

Invitations carrying firstTask now record the requesting coordinator as the return target, so their completion follows the same correlated report path as room_message. The MCP call returns acceptance without waiting for execution. Promotion checks the core's listening tool channel before changing the role. This transport check is not proof that a real CLI has successfully called every tool.

A modern room gate explicitly reports ownership. Once it claims the room, a rejected operation or unreadable ownership check returns an error and never falls through to family execution. Older gates without an ownership probe retain their legacy decline contract; an absent room still allows family-only messaging.

## Alternatives considered

**Let the model pass room and actor IDs.** Caller identity would be self-reported and could target another room. The token supplies both identities, and extra command arguments are rejected.

**Keep all coordinator requests behind human relay confirmation.** Ordinary background delegation would stop at every message. Coordinator authority and durable delivery provide the intended asynchronous path; unrelated worker relays retain their existing gate.

**Direct-send after any room error.** A permission or persistence failure would bypass the authoritative room. Explicit ownership makes those failures final.

## Consequences

External coordinators can inspect the room, invite workers and receive completion reports without a DSH model relay. Both tool transports share role checks and persisted dispatch semantics. No host source changes are required.

The formal goal/task/attempt tool contract, unified core message queue, broader automatic worker notification policy and real CLI/browser acceptance remain incomplete. Tests cover authenticated identity, invalid/idle/preparation tokens, injected room arguments, former-coordinator denial, first-task reports, bridge wire transport, optional native tool registration and refusal without a tool channel.
