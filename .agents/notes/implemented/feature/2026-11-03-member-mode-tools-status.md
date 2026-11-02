# Agent Note: The edit dialog shows a member's mode tools and reloads them

Status: implemented

## Problem

[The bug-fix note](../bug-fix/2026-11-02-member-mode-tools-never-silently-empty.md) made a member's missing mode tools visible to the host (a placeholder tool, a log warn, a `mode-tools.jsonl` line) and healed them at the next round start. The human still could not see it. Nothing in the room said whether a member could reach its mode's tools right now, a fix waited for the member's next round, and the round-start respawn left no trace in the room. A process started before the report existed looked exactly like a healthy one.

## Decision

The user approved the design on 2026-11-03 (prototype `proposals/prototypes/member-tools.html` v3, outside the repo).

**One line in the edit dialog.** The 编辑成员 dialog's head drops the sentence 「邀请时定下，要换就另外邀请一位」 and gains one **模式工具** line under Provider / 模式. It counts only mode tools: the preset's plugin tools that the member's current process received. Room tools are built into the bridge and are always available. The CLI's own tools are not ours to list. The expanded view mentions both in one footnote. A member without a mode gets no line. The states are:
- normal: `游戏开发 5 ✓ 查看▾`. Expanding shows chips, the footnote, a neutral 重新载入 and the last load time;
- missing: amber `0/5 ⚠ 未载入`, the button inline, one sentence with the time and the cause, and the missing tools as dashed chips. A list that is partly there reads 部分未载入;
- reloading, then 刚刚重新载入完成, or back to missing with 「重新载入后仍取不到」;
- running: the button reads 结束后重新载入. After a click it reads 已安排;
- just auto-reloaded: normal, plus a grey line until the next normal load after it;
- unreported (the process never listed): neutral, never shown as broken;
- no process: `· 下一条消息时载入`, with no button.

The dialog polls the read while it is open, every 1.5 s while a reload is in flight and every 5 s otherwise. The view model is a pure function (`packages/room/src/client/member-tools-view.ts`).

**The core read.** `MemberChannel` now records the tool names of each `complete` list, along with the count. A `MemberToolsTracker` (`packages/local-agent/src/member-tools.ts`) keeps, per member, the reload in progress, the last reload's outcome and the last automatic reload. `LocalAgentRegistry.memberToolsStatus(child)` reports on the current process, which is the most recently registered token that is still valid. The report has the mode, and the expected tools from `PresetToolHost.names`: the preset's plugin tools in the member's scope right now, with no diagnostics line and no settle wait. It has the process state (`full | placeholder | empty | unreported | none`), the received names with their time, and the reload fields. A member without a mode answers null. Both are on `localAgentGateway` as `memberTools` / `reloadMemberTools`. Room's client probes them lazily, as it already does for `memberModel`, so room shows no line without the family.

**Reload reuses the drivers' `prepare`, with a resume spec, not `prepareMember`.** `LocalAgentRegistry.prepareMember` refuses a member that already ran ("use its existing controls"). The harnesses' `prepareMember` builds a spec without `resume`, so Kimi would `session/new` and lose the conversation. Instead each live driver (Kimi, Claude Code, Codex) gains `reloadMember(child, { onStart })`, registered as the optional harness hook `reloadMember`. It chains a reload step onto the member's round queue (`roundChains`), so an idle member reloads now (`when: 'now'`). A running member reloads right after its round settles (`after-round`), and a round queued later waits for the reload. The step retires the resident runtime. It then calls the driver's existing `prepare` with the spec the runtime was last ensured with, plus the old process's CLI session id as `resume`. This yields Kimi `session/load`, Codex `thread/resume` and Claude `--resume`, with no prompt and no model call. `retireIfToolsStale` also reports through `registry.noteMemberToolsRespawn(child, oldToken)`. The reload counts as done when a token other than the old one lists (`loaded`) or serves the placeholder (`missing`). If nothing lists within 20 s, the status reads `pending`, which the dialog shows as "loads with the next message".

Whether the fresh process lists without a prompt was measured against the installed CLIs, with a logging stdio MCP server. kimi 2.4.1 lists at both `session/new` and `session/load`, and codex 0.163 lists at `thread/start`. So on Kimi and Codex the result shows within seconds. `claude -p` was not measured: the sandbox refused to spawn it with permissions skipped. A Claude member that does not list before its first input reads `pending`, which is honest. The previous note's statement that Kimi lists lazily at its first prompt does not hold for kimi 2.4.1. Its keep-unreported rule is still right for old bridges.

**The room notice is a new registered event, `room/member-tools`.** No existing room event fits: `room/member-updated` is a roster change, and `room/member-compacted` carries compaction facts. The core reaches room through a new optional gate method, `noteMemberTools(run, { kind, preset, during })`. Room appends `{ member, memberId, kind, preset, during }` for a CLI member it seats, and adds the type to `ROOM_EVENT_TYPES`. The type must be registered: the host reads only registered event types. Two cases write a notice. `reloaded` is written when a round-start respawn happens, before that round's own output. `unavailable` is written when the first process after a reload, automatic or requested, is served the placeholder (`during: 'round' | 'idle'`, with two wordings). The normal case writes nothing. The `room-event` chat node renders it as one amber dashed line. For `unavailable` the line carries 「编辑成员」, which opens the edit dialog in place. A chat node cannot switch the conversation view, because the host has no public view switch for plugins. So the edit dialog's save path moved into `MemberEditDialog.tsx` (`submitMemberEdit`), which the members tab now also uses.

## Alternatives considered

**Reuse `registry.prepareMember` as is.** Rejected, for the reasons above: it refuses started members, and its spec carries no resume.

**Retire only ("下一条消息时生效").** This was the approved fallback. It was not needed: the driver's `prepare` already spawns and configures a resident process without a prompt, so passing `resume` was the only missing piece.

**Interrupt a running round to reload.** Rejected by the design: the round goes on, and round-start self-heal covers a member nobody clicks for.

**Count room or CLI tools in the line.** Rejected: room tools never go missing, and CLI tools cannot be listed reliably. The footnote names both.

**Reuse an existing room event, or a modal.** Rejected, as above. The design also forbids a modal and a resident badge.

**Have the chat node switch to the members tab.** Not possible today: `ui-conversation`'s `openView` is internal, and the only public route is the tool-call inspector's focus.

## Consequences

- Room gains one event type (`room/member-tools`). Context Lens ignores it, and the lens contract fixture is unchanged, since no writer in that suite emits it.
- Kimi, Claude Code and Codex live drivers keep each member's last round spec in memory, and count the rounds in flight per member.
- The 模式工具 line mounts the member's preset scope on read if the bridge has not yet listed. That is the same mount a list does, without the diagnostics line.
- A `full` process whose list lacks tools the mode has now reads 部分未载入. The round-start check does not respawn that case: it only replaces placeholder and empty lists. A manual reload fixes it.
- The DSH member (`local-agent-dsh`) has no `reloadMember`. Its line shows the state without a reload button (`reloadable: false`).

## Testing

- `packages/local-agent/tests/member-tools-status.spec.ts`: full / placeholder / empty / unreported / none, and no mode → null. An idle reload is immediate and refuses a second click while it runs. A running reload stays scheduled until the round ends. A reload that still gets the placeholder tells the room once, as `unavailable`/`idle`. The 20 s pending window. Unsupported, no-process and unknown members. The auto reload tells the room (`reloaded`/`round`), keeps the dialog line until the next normal load, and reports `unavailable`/`round` when the new process still gets the placeholder. Tracker unit cases.
- `packages/local-agent-kimi/tests/live-driver.spec.ts`: an idle reload spawns a fresh process that only does `initialize` + `session/load` on the same session, and the next round reuses it. A running member's reload waits until the round settles, and the old process is untouched meanwhile. With no process there is nothing to reload. A round-start respawn reports the replaced token.
- `packages/local-agent-claude-code/tests/live-driver.spec.ts` and `packages/local-agent-codex/tests/live-driver.spec.ts`: an idle reload respawns with `--resume` / `thread/resume` and sends no prompt or turn.
- `packages/room/tests/member-tools.client.spec.tsx`: every line state in zh and en, no internal words in either dictionary, the in-place reload result, and the notice line with and without 编辑成员. `service.host.spec.ts`: `noteMemberTools` writes one event for a seated member and none for a stranger. `persistence.host.spec.ts`: the new type round-trips.
- Screenshots of every state (desktop and 390 px) were compared side by side with the prototype; they are not committed.
