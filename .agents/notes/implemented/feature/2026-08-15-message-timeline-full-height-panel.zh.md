# Agent Note: Full-height timeline panel for the message rail

Status: implemented

[English](2026-08-15-message-timeline-full-height-panel.md) | 中文

## Problem

消息导览 rail(`packages/message-timeline`)此前把消息列表呈现在一张悬停小卡片里,受 `previewMaxWidth`/`previewMaxHeight` 限制(默认 360×320),垂直居中于圆点 rail 旁,长对话只能在小框内滚动。卡片自己的滚动区还没有加载更早历史的触发:翻页只在圆点轨道上生效,而读者实际滚动的是列表。同时 store 里的 `selectedKey` 与 rail tracker 发布的 `activeKey`(当前阅读位置)重复——组件从未读过后者。

## Decision

悬停 rail 展开一条全高时间轴面板,锚定在 rail 实测几何框内:每行一条已加载用户消息,刻度加单行省略预览,样式全部走共享 `--dsw-*` token。(圆点轨道随后被移除,面板成为唯一的常显表面;见[扁平列表笔记](2026-08-15-message-timeline-flat-list.md)。下文的分页与高亮推导决策仍然有效。)高亮模型收敛为单一路径——`focusKey`(悬停或方向键预选),其次 tracker 的 `activeKey`,最后兜底最新消息——store 只保留 `open`,`selectedKey`/`setSelected` 删除。点击行或圆点跳转;跳转引发的程序化滚动让 tracker 重新发布 `activeKey`,高亮无需存储状态即落在跳转目标上。面板每次打开时定位到阅读位置,之后滚动位置归用户。分页机制保留并扩展:圆点轨道与面板共用一个滚动到顶部的 `loadOlder` 触发,读者实际滚动的面板现在也能翻页。配置以 `panelWidth` 取代 `previewMaxWidth`/`previewMaxHeight`(面板高度即 rail 高度),并删除未使用的 locale 键(`rail.loadOlder`、`rail.toTop`、`rail.toBottom`、`rail.previewLabel`)。

## Alternatives considered

**保留卡片,放大或取消上限。** 否决:任何固定上限对长对话仍是小框;tracker 本就实测了可用高度,全高面板比再加一个可调参数更简单。

**用面板取代圆点 rail。** 当时否决:收起态的圆点零成本提供密度与位置总览。后被[扁平列表笔记](2026-08-15-message-timeline-flat-list.md)采纳,当前交互以该笔记为准。

**保留 `selectedKey` 以跨重挂载持久化。** 否决:跳转引发的滚动事件会让 tracker 立刻重新发布阅读位置,持久化的选中没有收益,还可能与实时位置不一致。

**面板行虚拟滚动。** 暂缓且非必要:行是单行按钮,几百条已加载消息渲染开销很低,分页机制本身限制了增长。

## Consequences

一次悬停即可看到所有已加载消息,历史翻页发生在读者实际滚动的表面上。组件减少一条 store 通道,配置减少一个可调项;cordis.yml 中携带 `previewMaxWidth`/`previewMaxHeight` 的条目会成为未知字段(pre-release 立场:不留兼容层)。覆盖:组件规格通过面板驱动悬停、键盘、跳转与翻页;store、config 与 apply 规格锁定精简后的形状。
