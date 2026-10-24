# Agent Note: 子会话同步不再重复写入宿主的写入缓冲

Status: implemented

[English](2026-10-24-child-sync-routed-buffer.md) | 中文

## Problem

CLI 成员调用模式工具时次次失败，报 `append seq mismatch for "<child>": expected 19 at index 0, got 9`，连只读的 `game_open` 也一样。

local-agent 持有子会话写句柄期间，宿主会把每条新追加的事件放进这个写入器的缓冲（`session-persistence-jsonl` 的 `enqueueLive`），每 200 毫秒或在 `session/flush` 时统一落盘。而 `syncChildSession` 在每个镜像回合之后，又显式追加一遍 `snapshotEvents().slice(stored.length)`。还在缓冲里的事件不在 `stored` 中，于是被写了两次。显式写先落盘，缓冲里那份随后就过不了连续性检查。落盘失败会保留这批事件并暂停定时器，所以这个缓冲在句柄的整个生命周期里都卡住了。磁盘上的日志本身是完整的。宿主的 `tools/execute` 检查点会在工具执行前调 `sessions.flush`，因此成员调用的每个模式工具都撞上这次卡住的落盘。

## Decision

`syncChildSession` 先让宿主把缓冲里的事件落盘（`sessions.flush(session)`），再只补仍然缺的部分，范围限定在落盘之前就已存在的事件：也就是句柄打开前的事件，或者宿主根本不缓冲时的事件。如果同步遇到 `append seq mismatch`，就连同卡住的缓冲一起释放句柄，换一个新句柄从磁盘补齐。

## Alternatives considered

**每个句柄只显式补一次，之后全靠 flush。** 否决：这需要在重新挂载和新建两条路径上分别记录每个句柄的状态。「先落盘、再补缺」最终写入的内容一样，还能顾到不缓冲的宿主。

**在 PresetToolHost 里避开宿主检查点的 flush。** 否决：只是把症状藏起来。卡住的缓冲在释放句柄时、以及下次任何人触发 flush 时照样会失败。

## Consequences

- `room/tests/member-stream-persistence.host.spec.ts` 用真实的 JSONL 存储后端运行，现在会先让缓冲定时器触发，再执行一次 flush。修复前它复现出线上这个报错，修复后通过。
- 正在运行的实例里已经卡住的句柄，会在下一次同步时自愈。
