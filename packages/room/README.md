# @khorsheed/dsh-room

English | [中文](README.zh.md)

A room is a normal dsh session marked as a multi-agent group conversation: the standard chat UI hosts several peer agents addressed by @-mention, and the human is the hub. The room's entire state — identity, roster, blackboard, dispatch records, run states — is a journal of custom session events (`room/*`) on the room session, folded by a pure replay; the host half is the `room` Typert Remote service (`createRoom` / `isRoom` / `getState` / `invite` / `updateMember` / `removeMember` / `postMessage` / `cancel` / `listProviders`), and the client half mounts its generated Remote contribution through `ctx.remote.$mount` and registers only official slot/Definition entries, so the plugin installs into any profile with no edits to core packages.

Dispatch: leading `@name` tokens in the room composer address members (multiple @ fan out); a bare message is recorded to the blackboard and triggers nobody, with a light hint saying so. The @-completion lists only existing members — pure addressing, never invitation. Every member dispatch carries a uniform prompt: the member's role instructions (on the first dispatch; an edit rides the next dispatch as an update notice), then the blackboard increment since that member's previous dispatch, then the message text. Same-member dispatches serialize (the family resume lock allows one in-flight resume per child session anyway); different members run in parallel.

Members: the session's own main agent is seated at room creation as an equal member (`main`) — not @-addressed, it perceives nothing and says nothing (custom events never enter `deriveMessages()`, so member activity is model-invisible to it by default). CLI members are local-agent family delegations: the first dispatch starts a fresh child session (`parentSession` = room session), later dispatches resume the same CLI conversation, and the delegation handle is journaled (`room/member-updated` with `childSessionId`) so a reload reattaches the member. The members tab (`成员` view) owns the roster — per-row status + elapsed, trajectory jump, interrupt, instructions edit, remove — and the invite dialog (provider picker reflects the local-agent roster's login state; logged-out providers greyed). The main agent can also invite: the model-facing `room_invite` tool lands in the same invite path with `invitedBy: 'agent'`.

Chat flow: a member's reply renders as identity row (member-color dot + name capsule + provider) + unframed markdown + an action row replicating the official IconActions chrome (copy, child-session jump, honest duration, hover-revealed clock — deliberately no branch, no TPS); a running member is a ToolRow-isomorphic 24px line (StateDot +「ada 正在工作… · 12s」+ sweep with a `prefers-reduced-motion` fallback), the whole row a jump link into the child session, with a trailing stop button wired to `cancel`; joins/leaves and the human's own messages render as compaction-marker-style dim lines.

## Install

```sh
dsh plugin add @khorsheed/dsh-room
```

The package is self-mounting: `dsh.bundle.patch` inserts the `room` loader row, and the browser half is discovered through the `dsh.client` block. Removing the plugin removes every surface it adds.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.0-rc.7`): ⚠️ degraded — **CLI members are unavailable**: they require the local-agent family's public delegation facade (`start`/`resume`/`cancel`, the M1 of `proposals/active/2026-08-18-local-agent-delegation-api.md`, merged on this repo's main), which no published `@khorsheed/dsh-local-agent` carries yet. Invite answers `local-agent-unavailable`; the main-agent member and every other surface work.
- source line (deepseek-harness master): ✅ full — with the local-agent family (M1 or later) mounted for CLI members.

**Persistence**: room registers its eight `room/*` event types into the harness's `KNOWN_SESSION_EVENT_TYPES` catalog at apply time (a one-cast `Set.add`; the catalog's own header defers a registration surface for out-of-repo plugins "until such a consumer exists" — room is that consumer, and this is the surface's temporary form, to be migrated when the official one lands). A persisted room session reloads on any build with room mounted, and stays refused — safely, by design — on builds without it.

## Known Limitations and Deferred Work

- **No realtime room-state subscription**: the client store pulls `getState` on entry and after own mutations, and polls every 2s only while the current room has a running member. Another client's (or a tool's) writes surface within one poll tick at most.
- **Full blackboard increment, no windowing**: every dispatch carries the member's whole unread increment; long rooms with many members multiply CLI-side token cost. A window/summary policy is deferred.
- **Member-to-member @ is not wired**: a member reply containing `@other` does not yet surface a human-confirmed pending-dispatch card (phase-2 seam).
- **Cross-restart CLI continuation** needs the family facade's M4 (delegation-mapping persistence): after a host restart the room session itself reloads, but `resolveDelegation` misses the in-memory mapping, so a member's next dispatch fails its run until M4 lands.
- **Member visual identity is replicated chrome**: `.refChip`, the IconActions row, and the ToolRow sweep are not exported plugin API; room replicates their styles. Upstream visual drift is a maintenance tax — cosmetic, acceptable.
