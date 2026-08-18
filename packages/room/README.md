# @khorsheed/dsh-room

English | [中文](README.zh.md)

Room: a normal dsh session marked as a multi-agent group conversation — the standard chat UI hosts several peer agents addressed by @-mention. Full design: `.agents/notes/proposed/feature/2026-08-18-room-multi-agent-conversation.md`.

**Status: WIP (Step 0 spike + Step 1 scaffold).** What exists so far:

- Host `room` Typert Remote service: `createRoom` mints a normal session and appends the log-only `room/created` identity-marker custom event (persistence and reload-replay come free); `isRoom` recovers room identity from the event log.
- Client slot entries: a `sidebar.footer.action`「New room」button, a never-claiming `conversation.composer` chain entry (registration-shape spike; the @-mention takeover is Step 5), and a placeholder `conversation.view` members tab.

## Compatibility

WIP — not yet audited against a host release.

| Host line | Verdict |
| --- | --- |
| npm release (`0.1.0-rc.x`) | WIP |
| deepseek-harness master | WIP |
