# Agent Note: canvas 0.4.8 —— 标签条的 ＋ 尾槽移出滚动盒，建卡即回板

Status: implemented

## Problem

用户对画布的第二轮反馈提出四个问题，其中三个附了截图：

1. **「点新增画布没反应」——＋画布切换器开出了一个没人看得见的菜单。** 复现（0.4.7、右侧栏全屏、即用户本人的布局）显示 trigger 的 `aria-expanded` 已经翻开，但屏幕上一无所有。菜单在 a11y 树里，像素里没有。实测打开中的菜单：trigger 盒子的纵坐标是 y=−68，而标签条在 y=38——`position: sticky` 的尾槽待在 `overflow-x: auto` 滚动盒里，把下拉的包含块锚错了位置（sticky 套 overflow 的怪癖，随布局而变：窄的停靠侧栏恰好算对了，所以此前手测一直是过的），标签条的 overflow 再把错位后的残余裁光。用户据此认为按钮死了，并怀疑是板标签与卡标签的设计冲突。
2. **标签条的 × 比旁边的字形都小。** `IconCloseFill` 字形的叉只占 viewBox 的 9/16（outline 家族约 11–12/16），统一 12px 渲染时它就是行上最小的图标。
3. **建卡之后人留在被清空的草稿标签上**，toast 宣告的卡却在别处。当初「关行会带走 toast」的理由已经过时——toast 在 0.4.x 换上宿主 Toast 时就挪到了标签页根部，关行对它毫无影响。同一轮反馈还希望回车能直接建「起标题式」的快卡。
4. **铅笔/橡皮的选中态是深色 `primary` 胶囊**——那是动作按钮的语言，被一个模式选择穿在身上，而且两厘米外就是本页自己的模式开关（渲染/源码/分栏），人家用安静的 token 说同一件事。

## Decision

**尾槽是滚动盒的兄弟，不是乘客。** `TabStrip` 重组为 frame（拿底色与底线、零裁剪）＞ 滚动盒（只放行）＋ 静态尾槽。不再有 sticky——一个构造上就滚不走的空间不需要 sticky——下拉也永远不再有 overflow 祖先。滚动盒的 `padding-bottom: 1px` 加自身 −1px，让激活行的遮盖从裁剪边内部盖住 frame 的底线（overflow 按 padding 边裁剪）。同一实例新旧对照：0.4.7 在全屏下菜单不可见；0.4.8 在同一席位菜单、表单、创建全通。

**× 照抄宿主 dock 的答案。** `IconCloseFillRegular` 14——宿主 `TabPanel.tsx` 对同一个字形的渲染方式。（rc.1 图标线同时导出 Regular 与 Medium；prod 跑的是 0.1.7-rc.1。）

**铅笔/橡皮成为本页第二个分段控件。** 与上方 ModeSeg 同一组 token（`bg-layer-1` 组、`border-l1`、选中 = `bg-layer-2` + `label-primary`）；撤一笔/清空保留宿主 `Button` ghost，因为它们是动作不是模式。不与 `Button.module.css` 的变体规则打特异性战争——切换根本不用变体系统。

**建卡即回家。** `saveDraft` 成功后撤下草稿行、激活落卡的那块板；挂在根部的 toast 不随行走。`CardTextarea` 新增 `auto-enter` 和弦：单行时裸 ⏎ 提交（正是用户说的「起标题式」快卡），一旦出现 `\n` ⏎ 回归换行，⌘⏎ 始终提交；Shift+⏎ 是单行时的显式换行。输入框下的提示随当前可用的和弦切换（`detail.createHint` / 新增 `detail.createHintMulti`）。

## Alternatives considered

**重做标签模型（用户自己的提问：板行与卡行冲突吗？）。** 不冲突——「一条标签带、行从主体派生」正是 round-3 ⑥ 要的模型，表面的下钻都建立在它上面；死点击是穿着设计问题外衣的布局 bug。修复是结构性的，标签条的语法没变。

**用 `position: fixed` 或 portal 锚下拉。** 否决：那是给症状打补丁，保留着制造症状的脆弱结构（滚动盒里的浮层）；把尾槽移出去改动更小，还顺带消灭了「trigger 被滚走」这一失败模式。

**草稿里一律 ⏎ 提交。** 否决：编辑器先是 markdown 编辑器（多行文、粘贴的文档），才是标题框，所以裸 ⏎ 提交需要单行条件。这个条件诚实地标明了手势优化的对象：快卡，不是文章。

## Consequences

- 切换器的 outside-pointerdown 监听、菜单定位、创建流程一行未动——坏的只是承载它们的几何。
- `strip.client.spec.tsx` 的「行留着」旧断言改写为回板行为与和弦矩阵（单行 ⏎、两行 ⏎、Shift+⏎、⌘⏎、IME 守卫）；472 个测试全绿。
- 一小时换来的 dev-ops 教训：profile 的 `pnpm-workspace.yaml` 带 `overrides` 时，`dsh plugin install` 解析的是 override 而不是 package.json 里的 `link:`——dev 实例必须两处都指向 checkout（旧 lockfile 还会把 tarball 钉死在这两处之外）。给包升版本号还能避开 store 按 name@version 复用旧包。
- 全部由 0.4.8 承载；README 的卡编辑条目用双语写明了新手势。
