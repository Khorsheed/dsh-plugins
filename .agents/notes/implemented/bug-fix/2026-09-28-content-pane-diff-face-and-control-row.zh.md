# Agent Note: 内容面板的 diff 面有了自己的 body，路径行的控件也归了组

Status: implemented

[English](2026-09-28-content-pane-diff-face-and-control-row.md) | 中文

## Problem

共享内容面板上的两条 GUI 反馈（仓主，2026-09-28），都出在面板自己的 chrome 上，而不是任何消费方的内容。

**改动记录这一面完全没有 body chrome。** 内核把调用方的 `diffView` 直接塞进 `.body`——一个 `overflow: hidden`、没有内边距的 flex 列；而内容面拿到的是 `.previewScroll`（`padding: 10px var(--pane-inset)`、`overflow: auto`、`scrollbar-gutter: stable`）。于是消费方的历史视图贴面板左缘（x=0），而标题、路径、搜索行都在 24px 线上；它的 diff 卡片整幅出血；步进控件的上边框顶死表头分隔线——实测上方约 1.5 CSS px、下方约 20px，正是仓主报的「间距很奇怪」。更糟的是这一面根本不滚动：`.body` 会裁切，比面板高的 diff 被静默切掉（用 headless Chromium 渲染真实构建 CSS 复现：560px 面板里 40 行 diff，没有滚动条）。消费方自己的 `.historyScroll`（`padding: 10px 12px; overflow: auto`）在并入内核时只剩下一段死代码。

**路径行尾部的控件读起来像一坨意外的四连按钮。** `.viewControls` 在 JSX 里被引用，却在 `ContentPane.module.css` 里从未定义，于是这个 span 一个类都没有；它内部两个 `inline-flex` 组（改动/内容 与 预览/源码）因此落进行内格式化上下文——两组之间没有间距，而且不同高度的盒子（22px 药丸与 24px 分段控件）按**基线**对齐。

## Decision

一个面，一个 body。`ContentPane` 把 diff 槽位包进 `.diffScroll`（`flex: 1; min-height: 0; padding: 10px var(--pane-inset); overflow: auto; scrollbar-gutter: stable`），并在面板 embedded 时给 body 打上 `.bodyEmbedded`，由 `.bodyEmbedded .diffScroll` 去掉横向内边距——那段留白属于调用方自己的容器。该面在既有的按 (session, path) 滚动记忆里以自己的 `\0diff` 键保存位置，所以 改动 ⇄ 内容 来回切不会用一面的位置换掉另一面的。

路径行拿回它的分组：定义 `.viewControls`（`display: inline-flex; align-items: center; gap: 8px; flex: none`），并让视图切换器采用分段控件的尺寸（`.viewButton` 高 24px、`0 10px`、圆角 6，与 `.segButton` 一致），于是两组读作两个同级控件，而不是两个高度的粘连簇。

消费方的步进控件改为安静形态：`.stepper` 去掉边框、底色与药丸内边距，箭头变成 20px 图标按钮（`‹ … ›`，静息 tertiary、hover 有底片、链两端禁用）；死掉的 `.historyScroll` 规则删除。既然这一面的内缩与滚动由该面自己提供，diff 卡片就是其中唯一的「面」——卡片上方再来一个带框药丸就成了双层 chrome。

## Alternatives considered

**让消费方自己包一层（在 `FilePreviewTab.module.css` 里复活 `.historyScroll`）。** 爆炸半径更小，但 worktrees 的 diff 面仍旧被裁切、没有内缩，内缩常量要被复制进每个消费方，而且内核两个面依旧没有理由地不对称。

**保留带框药丸，只修内边距。** 仓主按渲染对比否决：diff 卡片是这一面唯一的面，上方再压一个药丸会跟它抢。

**改画一条通栏「历史条」**（药丸撑到卡片宽、箭头分列两端）。同样给了方案，同样被否，选了安静的内联行。

**把视图切换器（改动/内容）挪出路径行**——自成一条 tab 条，或移到该行的行首。此事仍未决：本次只把分组与尺寸定下来，位置问题留给仓主，改成 tab 形态属于另一个决策。

## Consequences

每个非 embedded 面板现在两个面共用同一个 body：历史视图落在面板的 24px 线上并且可滚动。worktrees 的标签页级详情面（非 embedded）同时获得同样的内缩与滚动容器，它的 embedded commit 面则只多一个滚动容器、不产生双重内边距。滚动位置按面各自记忆。

代价：diff 面现在会为滚动条预留稳定 gutter（内容面本来就如此）；步进箭头少了 2px 点击区（20px，仍在官方图标按钮尺寸上），换来安静控件的观感。

测试：涉及包的用例全绿（`ui-content-preview` 55、`ui-file-preview` 79、`worktrees` 90、`local-files` 35），内核用例仍钉住 diff 槽位的存在与切换。几何是纯 CSS——jsdom 没有布局引擎——因此验收是对构建产物 CSS 的像素测量（headless Chromium）：basename、路径、步进与 diff 卡片同起于 24px，步进上方间距 10px，溢出的 diff 出现滚动条，两组控件间距 8px 且等高。
