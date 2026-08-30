# Agent Note: message-timeline 社区化清理(竞态、kind 谓词、元数据、文档)

Status: implemented

English | [中文](2026-08-30-message-timeline-community-cleanup.zh.md)

## Problem

社区发布前,两次独立评审(用户 + 外部 codex 评审)暴露出少量质量问题,多数是外观或文档偏移,但有一处是真生命周期缺陷:轨道 tracker 调度了一个不可取消的 bind 帧;若会话在帧执行前变化、或插件在帧执行前被 dispose,过期回调会在错误的会话下绑定全局滚动区、重复挂监听器、或绑定进已销毁的 tracker。

## Decision

五个改动,都落在同一个包内:

1. **修 bind 竞态。** `teardownBind()` 现在递增 `bindToken` 代计数;bind 帧捕获它被调度时的 token,若不匹配就整体退出。rebind 或 dispose 会让所有更早的帧过期,过期 bind 永远不会挂监听器、覆盖新 ResizeObserver、或在 dispose 后绑定。两个回归测试覆盖 dispose-早于-首帧 与 帧前快速切会话。
2. **归并节点 kind 谓词。** "哪些 kind 算时间轴行"的判断原本散在三处(轨道 order 循环、`activeRowKey`、追加过滤器),可能漂移。`timeline-kinds.ts` 现在是唯一权威:`isTimelineRowKind(kind, includeSteering)`(user、可选 steering、message-tools-edited/restored)与 `isHiddenSpanCarrierKind(kind)`(withdrawn/edited)。轨道投影与 DOM 阅读位置 tracker 共用前者;`hidden-spans.ts` 用后者。这也让蓝色阅读位置标记与编辑/恢复气泡对齐(之前只认 user/steering 行)。
3. **声明 `dsh.client.immediately: false`** —— 浏览器 half 的约定;本插件通过 `slots.inject` 惰性注册槽位,不是立即执行。
4. **刷新两份 README。** 写入 `timeline-kinds.ts` 与 `hidden-spans.ts`,说明编辑/恢复气泡保留一行、被撤回原消息不保留,并修正宽度行为:流探针无应答时的 40% 兜底是 best-effort 降级,不是不遮消息流的保证。
5. **一次快照节点库。** `items` memo 之前调用两次 `nodes.values()`(一次折叠 span、一次追加),现在只读一次并复用同一快照,两个 try/catch 合并为一个。

先前修复里的"丢弃被撤回原消息"与"按 anchorSeq 排序"不变、刻意保留——评审确认它们正确且不过度设计。

## Verification

包内 106 个测试全绿(原 98):+2 bind 竞态回归、+5 timeline-kinds 谓词、+1 activeRowKey 识别编辑/恢复行。`pnpm build` 与 `typecheck` 通过。README 双语配对已重录同步。

## Alternatives considered

**维持原 bind、依赖 `dispose()`/`bind()` 顺序。** 否决:dispose 无法取消已调度的帧,竞态真实存在。
**给 span 折叠/排序加 `Number.isFinite` 守卫。** 否决(评审共识):真实宿主不产生非有限 `anchorSeq`;守卫属于投机性防御,代码已靠 try/catch 与跳过 unresolved 节点降级。
**按 session 变化重置 prefetch 计数。** 搁置:`conversation.session.header.utilities` 是每会话作用域槽位,组件跨会话会 remount 并自行重置计数;无验证复现。
**用单一共享谓词覆盖三处 kind 判断。** 修正:时间轴行集合与 span 载体集合重叠但不等同,所以在 `timeline-kinds.ts` 放两个谓词(不是一)。

## Consequences

tracker 在快速 rebind 或 dispose-早于-首帧时不再泄漏监听器/观察者。轨道、阅读位置标记、hidden-span 折叠共用同一套 kind 分类,以后加时间轴 kind 只改一个文件。包满足浏览器 half 元数据约定,README 描述真实(含 best-effort)行为。普通会话逐字节不变(无追加气泡 → kind 谓词与稳定排序都是无操作)。
