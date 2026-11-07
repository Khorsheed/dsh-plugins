# Agent Note: `/compact` reaches a member, and the room shows one compaction row

Status: implemented

## Problem

The compaction round (2026-10-31-member-compaction-round) had no entry point. The user chose a slash command over a new button (mockup `proposals/prototypes/member-compaction.html`, 2026-10-31): in a member conversation `/compact` compacts that member; in a room, `/compact` compacts the coordinator and `@member /compact` compacts that member. Input sent during compaction queues until it ends, and the summary is expandable when the CLI gives one.

## Decision

- **local-agent inbox**: a message that is exactly `/compact` (`isCompactCommand`) resumes with `operation: 'compact'`. The member FIFO already queues later input behind it.
- **room dispatch** (`runCliMember`): a human dispatch whose text is exactly `/compact` sends a compaction round instead of a briefed prompt.
  - It writes no `room/speech`. Kimi answers `/compact` with its summary text, and that belongs to the row, not to a reply.
  - It appends `room/member-compacted`, copied from the child session's last `local-agent/compaction` event: outcome, token counts before and after, window, usage, summary, error, duration. The type is registered in `ROOM_EVENT_TYPES`.
  - A member that never ran gets a done delivery reading 「还没有可压缩的上下文」 and starts nothing.
- **room client**: a `room-compaction` node (`RoomCompactionView`) draws one dim row with 看摘要 / 收起摘要 and a failed state. An expanded summary also ends with a full-width 收起摘要 button and an up arrow. Closing from the end returns focus to the top toggle without forcing it to scroll into view, so keyboard focus is not lost when the end button unmounts.
- **Coordinator path**: a bare `/compact` with no mention and no attachment, while dsh coordinates, runs the host's own `/compact` command through `ctx.remote.commands.execute`. That compaction is the host's, so the room adds nothing of its own.

## Alternatives considered

- **A 压缩 button in the room composer.** The user rejected it as a duplicate design: context-guard owns the only button, and it appears only above the threshold (a later phase).
- **Letting Kimi's summary land as a speech.** Rejected: it looks like a member reply, and coordinators would react to it as one.
- **Matching `/compact` anywhere in the text.** Rejected: only an exact command is unambiguous. Prose that mentions /compact stays a normal message.
- **A sticky summary collapse control, or moving the only control to the end.** A sticky action would float over long-form text; an end-only action would remove the established top entry. The two quiet controls share one state instead.

## Consequences

- A member's `/compact` holds its queue like any round, so a message typed meanwhile is delivered after the compaction ends, never dropped by Kimi.
- The room log gains `room/member-compacted`. A host without this room build refuses such a log, the same as any other room type.
- Still to come: the ring and threshold reminders (context-guard via `local-agent.member.tools`), the CLI's own automatic compaction recorded as `source: 'auto'`, and Context Lens reading `local-agent/compaction`.
