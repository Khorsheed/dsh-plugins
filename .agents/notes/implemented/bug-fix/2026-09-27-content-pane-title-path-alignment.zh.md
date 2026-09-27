# Agent Note: 内容面板 basename/路径对齐（返回键退进面板留白）

Status: implemented

[English](2026-09-27-content-pane-title-path-alignment.md) | 中文

## Problem

共享内容面板的详情视图画一条两行标题栏：第一行是 basename 加语言 chip，第二行是解析后的路径，返回键走在这一行最前。对 3080 实例上真实渲染的面板做像素测量（仓主截图，2026-09-27）：路径行距面板左缘 24px，basename 在 56px——正好是返回键的 24px 加标题行的 8px gap。同一个表头的两行不共左缘；仓主的验收意见是让两者贴同一条左缘、不要这么大间距。

障碍是几何的，不是审美的：留在 flex 流里的前置控件必然把它后面的内容按其自身宽度加 gap 右推，所以「返回键在 basename 前面」时 basename 永远落不到路径行的左缘上。只调 padding 只能让两行一起平移，因此每个候选方案都必须先决定控件放在哪里。

## Decision

这条线由一个 token 拥有：`ContentPane.module.css` 的 `.root` 声明 `--pane-inset: 24px`（以及 `--title-gap: 8px`），标题栏 padding、内容搜索行、notice / script-confirm 的 margin、正文两处滚动内边距全部消费它，于是没有任何一行 chrome 能各自漂移。

返回键改为占据这段留白，而不是排在 basename 前面：

```css
.titleBar:not(.headerEmbedded) .back {
  margin-left: calc(-1 * var(--pane-inset));
  margin-right: calc(-1 * var(--title-gap));
}
```

按钮的 border box 落在 0–24px，被抵消掉的右 margin 让 basename 起于 24px——与路径行、搜索行、正文同一条线；chevron 与 basename 之间可见的呼吸来自字形在 24px 按钮内的居中。动作组之前的行 gap 未动，markup、prop、翻译键都没有变化。

embedded 面板（`embedded` → `.headerEmbedded`，如 worktrees 的 commit 详情）保持普通流式行：那里的留白属于调用方的 chrome，内核无从测量，负 margin 会把控件推到面板外。

## Alternatives considered

**把返回键移到右侧动作组。** 确实能让两行都落在 24px，但「返回产物列表」离开了这个手势被期待出现的位置，只剩 tooltip 承载语义。

**保留前置控件，把路径行缩进到 basename（两行同 56px）。** 这是把两行一起推离面板边缘来「对齐」；诉求是贴左、没有那么大间距。

**让控件向留白里挂 32px，从而保住 basename 前的 8px gap。** 32px 超过面板 24px 的留白，按钮和它的 hover 底片会溢出面板左缘。

**新增 prop，或让调用方自绘一条对齐版标题行。** 几何属于 CSS 的职责；面板的 prop 契约保持不变，所有消费方重新构建即可拿到修复。

## Consequences

现在每个非 embedded 面板的 basename、路径、搜索行与正文都在同一条 24px 线上，留白是一个 token，共享内核的消费方（ui-file-preview 的产物详情、local-files 的工作区视图、worktrees 的 commit 详情）无需改 API 即可获得修复。

两处代价。返回键 24px 的点击区现在紧贴面板左缘，hover 底片的左侧圆角就落在边缘上。以及 embedded 面板被有意排除在外：worktrees 的 commit 详情里 basename 仍比路径行多一个控件的偏移，因为那个面板的留白属于内核无法测量的容器——那里的修复形状是调用方声明的 overhang token，而不是再来一个负 margin。

测试：几何是纯 CSS，jsdom 没有布局引擎，因此 `content-pane.client.spec.tsx` 仍然只钉住控件存在与点击行为，没有任何测试断言像素位置；本次改动的验收就是像素测量本身（两行同落在面板 24px 留白上，控件盒起于 0）。CSS Module 哈希在消费者 bundle 里保留了 `:not(.headerEmbedded)` 守卫（已在构建出的 `lib/client.js` 中核对），涉及包的 build 与 test 全绿。
