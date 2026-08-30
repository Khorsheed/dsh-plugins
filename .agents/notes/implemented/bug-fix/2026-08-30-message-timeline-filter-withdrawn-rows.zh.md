# Agent Note: message-timeline 过滤撤回用户消息的"死行"

Status: implemented

English | [中文](2026-08-30-message-timeline-filter-withdrawn-rows.zh.md)

## Problem

活体 bug(message-timeline × message-tools):撤回一条用户消息后,时间轴轨道仍显示这一行,但点击没反应——会话没跳过去。被撤回的消息出现在视图里却无法跳转。

与它一起暴露的还有第二个症状:最新用户消息可能在轨道里排在倒数第二。对**旧**消息做原地编辑会物化一个 `message-tools-edited` 气泡,其 `anchorSeq` 确实比最新 `order` 行旧,但按 store 遍历「追加到队尾」时,store 的迭代顺序不是 seq 顺序。

根因不在轨道的 kind 过滤。message-tools 的**撤回**(不同于**编辑**)会把被撤回的原 `user` 节点**留在宿主 `order` 里可见**——投影没有 suppress 缝隙,原消息从不从 `order` 隐藏。同级 `message-tools-withdrawn` 分割线(编辑则物化 `message-tools-edited` 气泡,同构)以 `{ hiddenStartSeq, seq }` 携带它覆盖的范围,而 message-tools 的 DOM hider 纯粹靠 CSS 在 `[data-chat-flow-key]` 上隐藏这些行。于是 `s.chat.order` 仍列出被撤回的原消息,轨道 `order` 循环把它当普通行渲染,但其会话行是 `display:none`——`jumpRow` 定位到零尺寸行,点击滚不动。

现有追加循环能补出 `message-tools-edited`/`message-tools-restored` 气泡,但不知道"覆盖范围"这回事,order 里的被撤回原消息从不会被跳过。

## Decision

- **一次性从 store 折叠撤回范围,再同时过滤两个循环。** `foldHiddenSpans`/`isSeqHidden` 从 `s.chat.nodes.values()` 里每个 `message-tools-withdrawn`/`message-tools-edited` 节点读 `{ hiddenStartSeq, seq }` 对(与 message-tools 自身 `foldHiddenRanges` 构建的列表一致:闭区间起点、开区间终点)。任何行——来自 `order` 循环或追加循环——只要其节点 `anchorSeq` 落在某段范围内,就是死行,被丢掉。
- **基线字节一致。** 普通会话没有 span 节点,`foldHiddenSpans` 返回 `[]`,什么也不过滤;每个 order 行照常渲染。修复绝不改变基线;span 折叠与追加一样包在防御性 try/catch 里,store 读取失败就降级为无 span(基线行仍渲染)。
- **span 终点保持为行。** 分割线/编辑气泡锚在 `seq`——开区间终点,`isSeqHidden` 对它为 false——活替换或分割线永不被过滤,只有被覆盖的原消息(已隐藏、不可跳转)被过滤。
- **追加的气泡按 seq 重排到它在会话中的位置。** `order` 循环按 seq 有序,但追加循环按 store 非 seq 顺序遍历,导致旧消息的气泡被推到最末、排到最新行之后。两个循环结束后,把合并结果按 `node.anchorSeq` 升序排序。JS 的 sort 是稳定排序,普通会话没有追加气泡(其 order 循环结果已按 seq 有序),因此从不会打乱基线。撤回原消息的过滤在排序前执行,被丢弃的死行不会重新冒出来。

## Verification

回归测试:`order` 中仍存在的被撤回原消息被丢弃,而 span 之后的未动用户行照常渲染;锚在 span 内的 `message-tools-edited` 被过滤,锚在 span 终点的被保留;纯折叠对普通会话返回 `[]`、按起点顺序折叠撤回+编辑范围;更旧的追加气泡排在新用户行之前(`tests/hidden-spans.client.spec.ts`、`tests/TimelineRail.client.spec.tsx`)。包内 98 个测试全绿;`pnpm build` 与 `typecheck` 通过。

## Alternatives considered

**单靠 `node.visibility === 'hidden'` 过滤。** 对撤回不够:留下的原消息仍是 `visibility: 'visible'`(只有 DOM hider 隐藏它的行),轨道 `order` 循环仍会选中它。span 折叠才是与 DOM hider 一致的信号。

**读 message-tools 模块复用 `foldHiddenRanges`。** 否决:message-timeline 必须独立(只读 store,绝不 import 同级包)。`foldHiddenSpans` 从通用 store 节点数据重新推导同一个 span 列表。

**把被撤回原消息并到分割线下面当成一行。** 否决:原消息已隐藏(无跳转目标),分割线承载历史,轨道是用户消息索引——死行比没有这行更糟。

## Consequences

被撤回的用户消息不再以"死行"出现在轨道(点击任何一行都能落地),追加的编辑/恢复气泡也落在它在会话中的真实位置,最新消息永远是最后一行。普通会话逐字节不变;锚在 span 终点的编辑气泡仍渲染、可跳转。span 折叠与追加都按会话走且防御式处理,瞬时的坏 store 读取从不会隐藏基线。
