# Agent Note：收窄状态的卸载冲刷

Status: implemented

## Problem

3199 上现场复现（build 443f149d）：读者设了来源筛选（query `#rss-…`，墙正确收窄），然后点了 dockkit 分栏按钮——它会挪座位重挂面板体——随后又在新增弹窗里加了一个 feed。一切落定之后，搜索框**空了**，墙也不再收窄。

收窄状态（view / query / sort / unreadOnly / 已读游标，外加整墙翻译开关与卡片译文）住在按挂载创建的 store 里，靠页面级会话记忆跨重挂载：一个被动 `useEffect` 在每次变化时把它镜像进去，下一次挂载从这份记录 hydrate。[状态边界 note](../architecture/2026-09-19-reader-state-boundaries.md) 立的就是这个模式。它没扛住的是：镜像是**被动** effect——在提交之后才冲刷，而读者最后一个手势与分栏挪座位落在同一个提交窗口时，面板可能在待冲刷的镜像跑起来之前就被卸载。每一次漏冲刷，都是下一次挂载 hydrate 出**上一个**收窄；分栏之后紧跟的新增流程（刷新 → 重载 → 重新解析）恰恰是会把窗口撑大的那种提交流量。

阅读位置从来没有这个病，因为它在**手势发生时**就写（`rememberReadingPosition` 是滚动处理器直接调的）。收窄走的是 effect——同一份记忆、两种写入时机，而能丢的恰好是走 effect 的那一个。

## Decision

保留 effect 镜像（它仍是按变化写入的路径），补上不带时机的保证：**卸载冲刷**。一个 ref 装着最近一次**已提交**的收窄——在渲染期间赋值，所以它在每次提交时就是新的，而不是某个 effect 有空的时候——而卸载 cleanup（它**总是**会跑）把它写进会话记忆。cleanup 带着镜像自己的守卫（`hydrateStartedRef`）：没活过 hydrate 前渲染的面板绝不能用 store 的默认值覆盖记录——镜像跳过第一次运行也是同一个理由。

冲刷与镜像走同一个 `patchSession`，所以 `sessionStorage` 的位置层（view / 打开的条目）在同一次调用里落盘，照旧。

## Alternatives considered

**在 store action 里写穿（setQuery 之流同步 patch 会话）。** 时机最强，但镜像还盖着三个 useState 字段（整墙翻译开关与卡片译文），而且 store 的 action 刻意保持纯粹——一份记忆两套写入机制，正是上一个 bug 的来路。cleanup 从同一个 ref 一视同仁地覆盖 store 与 useState 字段。
**更早 hydrate（第一次渲染就水合，不等第一个 effect）。** 丢的是写入侧，不是读取侧；更早 hydrate 对一笔从没落下的写入什么都改变不了。
**不修——这个序列很少见。** 收窄是面板的日常状态，分栏如今是宿主的一等手势；「通常来得及冲刷」不是持久化契约。

## Consequences

- 重挂载再也不会回到比读者最后一次看到的提交更旧的收窄，无论 effect 调度器做了什么。
- 镜像保持原样（每次变化一次写入、守卫第一次运行）；冲刷与它是幂等的。
- 回归钉在三层：纯重挂载带来源筛选；3199 原序列（筛选 → 重挂载 → 加 feed → 关弹窗）；以及镜像根本没写的情形本身（两次挂载之间抹掉快照，只有 cleanup 能把收窄找回来）——外加详情页与 query 一起回来。

## Testing

`packages/dsh-reader`（+3）：`tests/ReaderPane.client.spec.tsx`——来源筛选（`#hn`，两个 feed 让行数可证）扛过纯重挂载；扛过重挂载 + 新增源 + 关弹窗的完整序列；扛过镜像从未写入（卸载 cleanup 是唯一写者）；以及收窄与打开的详情页一起回来。漏镜像用例在修复前红过；序列用例两态都绿，留作守卫。
