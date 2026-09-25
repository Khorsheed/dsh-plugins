# Agent Note: 共享内容面板的「刷新当前文件」手势（调用方注入 `onReload`）

Status: implemented

## Problem

每个社区文件面展示的都是「选中那一刻」的文件内容。文件在磁盘上变了——agent 改了它、用户在编辑器里保存、一次 git 操作重写它——面板就保持陈旧，除非重新选中文件；此前没有任何手势能表达「再读一遍」（仓主 2026-09-24 提出：本地文件/工作树右半边的文件渲染区加一个刷新图标和能力）。

塑造答案的约束是面板自己的边界：共享内容面板（`@khorsheed/dsh-client-ui-content-preview`）不持有 IO——`read` 以 prop 到达，各消费方的 Remote 才知道怎么产出它。因此重读手势无法以 fetch 的形式住进内核；能共享的只有 chrome（按钮、进行中反馈、文案）。

## Decision

`ContentPane` 新增一个可选 prop `onReload?: () => Promise<void>`（`packages/ui-content-preview/src/client/contract.ts`）。注入后，标题行动作区在复制路径之前渲染一个刷新钮（官方 `IconRefreshOutlineMedium`）；返回的 promise 未落定期间按钮禁用、图标旋转（dsh-reader `.toolSpinning` 先例：作用域化的 `pane-spin` keyframe，带 `prefers-reduced-motion` 回落）。进行中状态归面板自己——调用方 promise 落定是唯一存在的「完成」信号。文案走调用方注入的 `t`，新增键 `action.reload`（各消费方字典 zh 重新加载 / en Reload；`PREVIEW_KEYS` 覆盖测试让缺键在三个命名空间里都是测试失败）。不传 `onReload` 的调用方渲染结果与之前逐像素相同。

三个消费方同构接入各自的读路径，重读进行中保持旧内容可见（重读绝不先清 read——与重新选中不同）：

- `local-files` WorkspaceView：对选中路径重调 `readFile`；成功走 `setPreview`（顺带清错误槽），失败走 `setError`——该包既有的读取失败通道。晚于选择变更到达的答案经选择 ref 丢弃。
- `worktrees` WorktreesTab：选择 effect 的抓取逻辑抽成共用的 `fetchDetail(dropped)`，effect 与手势共用，于是重读重拉的是当前视图（diff 走 `fetchFileDiff`，内容/图片走 read Remote），分支完全一致；成功臂顺带清掉陈旧 error；旧答案守卫以 path/segment/view/commit 为键。`CommitDetails` 刻意不传 `onReload`：文件钉死在那一提交，内容不可变，手势只会重读一个不可能变化的值。
- `ui-file-preview` FilePreviewTab DetailView：重调自己的 `readFile(sessionId, path)` 并更新本地 read 状态；改动记录侧（fold diff）不在范围内——它的数据是清单，由列表页自己的刷新钮刷新。

## Alternatives considered

**监听文件系统并推送失效。** 否决：宿主对任意本地路径没有 watch 能力；这个手势已覆盖被报告痛点（用户知道自己刚保存）；推送通道是一条上游 seam——不是三个客户端插件能本地发明的东西。

**复用各面既有的刷新（local-files `rev` / worktrees `refresh()`）。** 否决：那些重读的是清单与 summary 面——比「这个文件」更宽、更贵的抓取集合；且 worktrees 的详情 effect 刻意不以 `rev` 为键。该手势限定在当前文件的当前视图。

**由消费方持有的 `reloading` prop。** 否决：每个消费方都得重写同一套 pending 记账；调用方返回的 promise 本来就带着落定信号，所以反馈状态归面板，契约保持单回调。

## Consequences

所得：一个手势、一份 chrome 与反馈实现，三个面同时愈合——下一个面板消费方供给一个回调即得此钮。无 IO 边界守住了：内核仍然对 Remote 一无所知。

所费：`onReload` 进入 prop 集、`action.reload` 进入打印键集（两者都被消费方字典测试机械钉住）。重读失败的呈现继承各包既有错误通道——local-files 的该槽与清单共享，一次失败的文件重读也会标记树列；这是该包对任何失败读取的既有惯例，不是此处新引入的妥协。

## Testing

`content-pane.client.spec.tsx` 钉住契约：按钮仅在供给 `onReload` 时渲染且排在复制路径之前、点击调用它、promise 落定前按钮保持禁用（并有点击守卫）。每个消费方的 tab spec 用「第二次返回新内容」的 mock Remote 断言重读——local-files 与 worktrees 还钉住失败路径（旧 read 保留、走错误通道）与下一次重读的恢复。`action.reload` 的 zh/en 字典覆盖由三个消费包既有的 `PREVIEW_KEYS` spec 断言。
