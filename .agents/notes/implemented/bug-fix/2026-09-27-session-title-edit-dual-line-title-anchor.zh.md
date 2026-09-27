# Agent Note: session-title-edit 的标题定位改为双线共用

Status: implemented

[English](2026-09-27-session-title-edit-dual-line-title-anchor.md) | [中文](2026-09-27-session-title-edit-dual-line-title-anchor.zh.md)

## Problem

本插件的就地编辑需要隐藏官方标题节点、并在它的测量矩形上覆盖自己的输入框——因为官方 header 至今没有暴露标题槽位。宿主 0.1.6 及更早，当前面包屑是一个 disabled `<button>`，所以探针写成 `header nav button:disabled`。宿主 0.1.7-alpha.1（上游 `92101e1a5b`，「render the current crumb as text so the title joins the drag band」）把这枚 crumb 改成了纯文本——在 darwin 上，全局 no-drag 规则会把 disabled 按钮从窗口拖拽条里减掉，标题因此成了一块既不拖窗、也选不中的死区。在这一线上，那句探针一个都匹配不到：点击铅笔后静默退回 header actions 行的行内编辑器，官方标题照旧显形（2026-09-27 在 0.1.7 的 web-eval 实例上收到报告）。改名本身从未坏过——它走官方 `session.rename` RPC——但「标题自己变成输入框」正是这个功能的全部意义，而这个意义恰好在用户正在迁移过去的那条线上丢了，0.1.5 线反倒还在。单测始终是绿的，因为它的「官方 header」是手写夹具，把 disabled 按钮的 DOM 写死在里面，宿主换 DOM 它看不见。

## Decision

一套定位同时服务两条线。当前标题 = crumbs nav **最后一段** crumb 里文本等于该会话 `displayTitle` 的叶子节点：crumb 渲染的正是同一份 store 里的 `summary.displayTitle`，所以两条 DOM 上比较都是精确相等；叶子优先于段容器（段容器里还含 `/` 分隔符与 lineage 槽内容）。祖先 crumb 在更早的段里，永远不会被误动。旧形状保留为**同一段内**显式的回退臂（`button:disabled`）——它让 0.1.5/0.1.6 在标题尚未投影时依然可用，并且刻意不再是全局 `document.querySelector`。隐藏规则改为元素无关（`header nav [data-ste-inplace]`，原为 `button[data-ste-inplace]`）。定位失败仍退回行内编辑器；改名路径、字节预算闸门、宽度适配与键盘行为一字未改。

主锚点从本条目自己渲染出的控件沿祖先向上走，直到某个祖先的 `previousElementSibling` 是 crumbs nav（actions 行与该条目之间还隔着该槽自己的 `[data-slot=…]` 锚点，`display: contents`）；其次回退到所在 `<header>` 的 nav，最后才是旧的 disabled 按钮查询。测试按各线真实骨架复刻——`titleCluster > nav >（每个面包屑一个 crumbSeg：分隔符、当前标题在最后）+ actions 行 > 槽锚点`——并把就地编辑套件跑两遍（`legacy` / `current`），条目按宿主的方式**挂进那个槽锚点内部**（只走一层 `parentElement` 的实现过不了这批用例，这正是必须沿祖先上溯的 DOM 细节）。邻居安全直接断言：与当前标题同文的祖先 crumb 保持可见；顶替官方 `conversation.session.header.lineage` 槽的兄弟节点属性不被改动。

## Testing

包套件 62 绿。就地编辑套件（11 + 3 例）按 `legacy` / `current` 各跑一遍，夹具复刻各线真实标记；把旧定位恢复后这批用例 11/11 全红（用 `git stash` 实测），所以它们是回归闸门而非现状描述。

实机验证（2026-09-27，就在此前坏掉的那条线上）：在 scratch `DSH_HOME` 里建一次性 profile（`dsh plugin --profile web add <worktree>/packages/session-title-edit`，link 安装），宿主 `0.1.7-rc.2`，打开一个真实种子会话后点铅笔。官方标题节点是文本等于会话标题的 `SPAN`，带 `data-ste-inplace`，矩形 300/11/184×28；覆盖输入框落在同一矩形（300/11、190×28），预填当前标题；没有行内编辑器出现；Escape 后节点复原、覆盖层消失。修复前同一操作得到的是行内编辑器、标题照旧显形。

旧线的覆盖缺口如实记下：0.1.5/0.1.6 臂由双线单测，以及对已发布 0.1.5 产物 bundle 的 DOM 直读（`disabled: last`）钉住，**不是**实机跑出来的——一次性 0.1.5 实例确实起过，但那个 scratch home 的 workspace 浏览器不肯列出种子会话（渲染器/store 的一次性 home 限制，与本插件无关）；而本仓 CI 的 `gates` job 本来就把本包套件跑在钉住的 `dsh-v0.1.5-rc.1` 线上。

## Alternatives considered

- **保留全局 disabled 查询并嗅探宿主版本。** 本仓的双线约定禁止版本嗅探，而且该查询在新线上照样得改；一条基于文本的探针无需分支即可覆盖两线。
- **按 CSS Module 类名定位（`span.crumbCurrent`）。** 类名逐构建哈希（`wSkVaW_crumbCurrent`），是构建产物不是契约；两条线真正共有的东西是渲染出来的标题文本。
- **注册进 `conversation.session.header.lineage`。** 它是官方唯一的标题旁槽位，但它是 `single`，且已被 ui-subagent 以默认优先级占用：同优先级注册会在 boot 抛错（"single slot … already has a registration"），压优先级遮蔽则会让所有会话的官方子代理 lineage 消失。
- **先向上游要一个真正的标题槽位、再谈修复。** 作为终态是对的（插件里的 TODO 至今这么写），但 0.1.7 线的用户当下就在丢就地位；DOM 锚点本来就以「带降级路径的过渡方案」记档，所以先修好它，等标题槽位出现再整体退役。
- **按结构锚定「最后一段里第一个非分隔符子节点」。** 在子代理会话上会坏：那一线上整个 crumb 由 lineage 槽渲染（`renderSlot(..., { fallback: title })`），标题文本在 ui-subagent 自己的标记里；文本匹配仍能找到它，结构猜测则不能。

## Consequences

- 0.1.7-alpha.1 起的就地编辑复活，同时不牺牲 0.1.5/0.1.6：一条代码路径、一个属性、一条 CSS 规则。代价是定位依赖「渲染出的标题文本等于投影的 `displayTitle`」（今天按构造必然成立）；若某天宿主在那里渲染的是另一种归一化的标题，插件会退回 actions 行编辑器，而不是误隐藏别的东西——这正是它一直以来的失败模式，现在两个方向都有测试。
- 覆盖缺口如实记下：夹具仍是手工复刻的宿主标记，所以**未来**的宿主 DOM 迁移单靠单测抓不住。这里替代它的是对两条线的直接核对（0.1.5 的产物 bundle 渲染 `disabled: last`；0.1.7 渲染纯文本 span）加上下面的实机验证。真正应当取代这层覆盖的上游缝是 `conversation.session.header.lineage` 一类的标题座位；在 header 开出标题座位之前，TODO 继续挂着。
- 兼容标注随修复移动：`dsh.compat.verifiedHost` 由 0.1.2-rc.1 前移到 0.1.7-rc.2 并补 `notes`，两份 README 现在都写明「已发布的 ≤0.2.3 在 ≥0.1.7-alpha.1 宿主上会降级、下一版恢复」。`minHost` 保持 0.1.2-rc.1 —— 地板不为一个修复移动。
