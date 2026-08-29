# Agent Note：local-files 工作区预览记住上次浏览到的文件位置

Status: implemented

[English](2026-08-29-local-files-scroll-memory.md) | 中文

本笔记记录这个决策：让 local-files 工作区预览在"切换 tab 再回来"时恢复用户上次浏览到的位置（滚动偏移），而不是回到顶部。

## Problem

local-files 工作区 tab 是 `conversation.view` 槽位项，宿主只渲染激活的那一个视图（宿主 `ConversationSession` 里的 `renderSlot('conversation.view', props, { only: active.id })`）。切到别的 tab（chat / 产物 / worktrees）会卸载 `WorkspaceView`（连同 `DetailPane`），`scrollTop` 作为纯 DOM 状态随之丢失。所以"看某个文件到一半、切走再切回"就回到了顶部——尽管内容与选中文件其实还在（它们存在于 per-session 的视图 store 里，槽位框架按 scope 存活：`storeOf(entry, scopeKey)`）。

需要调和的两件事：内容/选中在，但滚动（DOM 状态）不在。

## Decision

用一个模块级 `Map`（键 = `<sessionId> \0 <绝对路径>`）记录当前选中文件内容区的滚动偏移，并在挂载/内容就绪时恢复。实现落在 `packages/local-files/src/client/DetailPane.tsx`：

- 给可滚动容器（文本/结构化/html 源码的 `.previewScroll`、图片的 `.imageScroll`）挂 `useRef<HTMLDivElement>(null)`（`scrollRef`）。
- `onScroll` 把 `scrollRef.current.scrollTop` 写回 Map —— 纯 Map 写，滚动不会触发文件树重渲染。
- 一个以 `[memKey, read]` 为依赖的恢复 `useEffect`：有缓存偏移时把 `scrollRef.current.scrollTop` 设回。

选模块级 Map 而非 store 字段，是因为 store 字段每次滚动都会触发 `useStore(s => s.scrollTop)` 订阅 → 整个视图（含懒加载文件树）逐帧重渲染；模块 Map 每次滚动只做一次写、无订阅、且能跨视图卸载存活。`WorkspaceView` 把当前 `sessionId` 传给 `DetailPane` 作会话命名空间。

HTML **渲染**模式（沙箱 `srcDoc` iframe）在它自己的文档里滚动，父页读不到也设不了（唯一源）；该路径刻意不恢复。代码/markdown/JSON/CSV/文本/结构化与图片预览可恢复。

## Alternatives considered

- **store 字段（local-files store 里加 `scrollTop`）。** 检查后否决：正确性上要 store 跨卸载存活（可以），但每次滚动都会写状态 → 触发 `useStore(s => s.scrollTop)` 订阅者逐帧重渲染，含懒加载文件树。模块 Map 避免了它。
- **卸载时捕获（effect cleanup）。** 否决：React 在 mutation 阶段就 detach ref，passive effect cleanup（在 mutation 之后跑）已读不到 `scrollRef.current`。改为逐滚动事件捕获更简单且无损（卸载前最后一次滚动已经记录了偏移）。
- **per-session 单偏移（一个槽，不按路径键）。** 否决：按路径键才能做到"每个文件记住各自的位置"（选别的文件再选回来仍可恢复），这正是用户要的"记住在文件里读到哪"。

## Consequences

- 无宿主改动；插件保持自包含、可独立安装卸载（`@khorsheed/dsh-local-files`）。`pnpm check:plugins` / `check:hygiene` 预期不变。
- 滚动缓存按页面会话（模块缓存）；插件重载后重置。上限 = 一个页面会话内浏览过的路径数。
- 本次只改用户报告的 local-files；worktrees 的「仓库文件档」内容区有同样的"切 tab 卸载"结构，是可能的后续项，不在本次改动里。
