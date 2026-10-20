# T83 视觉对齐：共用件规格与施工图（第一、二阶段）

> 范围：web-eval 的「实验室」「题集」两个 tab，对齐交互稿 v5（`proposals/prototypes/eval-journey-redesign.html`）的**视觉组件层**。
> 本文件只定规格、映射和施工图，不含客户端代码。信息结构与措辞不动（T79 / T80 已对齐层次），eval 与 datasets 互不 import。
> 基线：worktree `feat/t83-visual-parity`（从 main `2de1e6aa` 开），`DSH_HARNESS=~/code/deepseek-harness-0.1.7-rc.1`，临时实例跑在 0.1.5-rc.1 工具链上。

## 〇、结论先行

1. **「半成品」观感的三个主因都能从代码里指出来。**
   - 版心：`.body` 拉满 tab 宽，1440 下内容列宽 1158px。
   - 按钮：宿主 `Button` 的默认 variant 是 `ghost`。两包一共 83 处 `<Button>`，只有 21 处写了 variant，其余 62 处渲染出来都是裸文字。
   - 字号：`.view` 把正文压到 12px/18px，v5 正文是 13px。
2. **版心不照搬 v5 的约 600px。** 那是交互稿排版挤出来的宽度（1440 画布减导航、注释栏、假侧栏），CSS 里没有声明。
   - 宿主已经公开了一条内容轴 `--dsh-chat-content-width`，值为 `clamp(680px, 列宽×0.64, 920px)`，可由用户拖动。1440 下实测是 742px，composer 卡片宽 774px。
   - 建议版心 = `min(100%, var(--dsh-chat-content-width, 720px))`，这样内容与浮动输入框同轴。0.1.5 和 0.1.7 都有这个变量。
3. **「底部被输入框压住」在当前 main 上复现不出来。**
   - 测了 3 个视口 × 6 个场景，滚到底时最后一段都在输入框上方 16px 处。
   - 最可能的来源是拿滚动顶部的静态截图判读：overlay 模式下，内容本来就从输入框底下滚过去。
   - 详见 §五。第二阶段仍有两处加固要做。
4. **宿主 token 覆盖 v5 的绝大部分颜色。** 映射不上的有三个：`bg-l2`、`ok-ink`（浅色）、`bg-side`。
   - 另查出插件现有 CSS 引用了两个**宿主不存在**的 token：`--dsw-alias-bg-l2` 用了 7 处，`--dsw-alias-state-danger-label` 用了 3 处。这两个 token 在 0.1.5、0.1.7 上都解析为空，背景透明、颜色继承。这是当前的实际缺陷。

## 一、v5 的版式基线（从 CSS / DOM 抽出）

| 项 | v5 值 | 说明 |
|---|---|---|
| 正文 | 13px / 1.5，`--l1` | 表格、按钮、段标题都以 13px 为基准；次要信息 12px |
| 内容区内边距 | `.body{padding:14px 20px 18px}` | 左右 20px |
| 内容列宽 | 约 606px（`.app` 848 − 假侧栏 200 − 左右 padding 40） | **无 max-width 声明**，是交互稿画布的产物 |
| 段间距 | `.sec{margin-bottom:16px}` | 段标题 13px/600 |
| 圆角阶梯 | 12（卡片、下一步条）/ 10（按钮、阶段条、列表行）/ 8（小按钮、seg2）/ 6–7（胶囊、seg 内项） | |
| 线 | 表头下线 `--b2`，行线 `--b1`，最后一行无线 | 表格只有横线，无竖线 |
| 窄屏 | 只在 760px 处收：列表行去掉 meta 列，并排改单列 | 其余元素没有写窄屏规则，下文 §二 逐项补 |

## 二、共用件规格

每个共用件依次写：用途、尺寸、token、明暗、400px 下的折叠方式。token 名只取宿主主题里真实存在的（以 0.1.5-rc.1 `dsh-client-ui-theme` 的 79 个 alias 为准，0.1.7 是它的超集）。

### E1 版心

- **用途**：所有页面内容的列。页头、阶段条、下一步条、各段都在这一列里。
- **规格**：`.body` 内再包一层列：`width: min(100%, var(--dsh-chat-content-width, 720px)); margin-inline: auto`。body 左右 padding 保持 12px，400 下内容宽 = 视口 − 侧栏 − 24。
- **宽表**：逐条判据、对比组表、运行记录格子这类表宽可以超出版心吗？
  - 不超出。表在版心内横向滚动（`overflow-x:auto` 包在 wrapper 上，现有 `.criteriaScroll` 就是这个形状）。
  - 这样与 v5 一致：v5 的表也在同一列里。
- **token**：`--dsh-chat-content-width`（宿主 ConversationRoot 公开的宽度轴，不是 `--dsw-*` token，与已在用的 `--dsh-composer-height` 同类）。fallback 720px。
- **明暗**：无关。
- **400px**：`min(100%, …)` 自动退化为满宽。

### E2 页头（xhead）

- **用途**：实验名、状态、问题。它替换现在的 `css.bar` 行（回到列表 · 名字 · 胶囊 · 刷新）。
- **规格**：
  - 容器：flex，wrap，gap 10，下边距 10。
  - 第一行：返回链接 `← 全部实验`，12px `label-tertiary`，悬停 `label-secondary`。
  - 实验名 15px/600 `label-primary`，后接 E6 状态胶囊。
  - 右侧留给页级辅助动作（刷新），用 E5 ghost 小按钮。
  - 第二行 `.q` 是问题副标题：`flex-basis:100%`，13px `label-secondary`。
  - 列表页页头：左边是 13px/600 的「实验」，接 E12 seg2（本会话发起 / 全部），右边是 E5 主按钮「新建实验」。
- **token**：`label-primary / label-secondary / label-tertiary`，`dsw-font-family`。
- **明暗**：全走 alias，自动。
- **400px**：名字 `min-width:0` 省略号；胶囊不换行；问题行照常折行；「刷新」收成图标按钮（有 `aria-label`）。

### E3 阶段条（stages）

- **用途**：实验设计 / 运行记录 / 结果对比 / 人工评估四页切换，每项带状态点。它替换现在的 `css.pages / pageTab / pageDot`。
- **规格**：
  - 容器：`inline-flex`，gap 4，1px `border-l2`，圆角 10，padding 3，`width:fit-content; max-width:100%; overflow-x:auto`。
  - 项：padding 4px 12px，圆角 7，13px `label-secondary`。
  - 当前项：背景 `interactive-bg-active`，文字 `label-primary`，字重 500。
  - 状态点 6px 圆：
    - 未到：`border-l4`
    - 完成：`state-success-primary`
    - 进行中：`state-business-primary`
    - 要人处理：`state-warn-primary`
- **token**：`border-l2`、`border-l4`、`interactive-bg-active`、`interactive-bg-hover`（非当前项悬停）、`state-success-primary`、`state-business-primary`、`state-warn-primary`、`label-primary`、`label-secondary`。
- **明暗**：自动。
- **400px**：条本身横向滚动（`overflow-x:auto`），当前项 `scrollIntoView({inline:'nearest'})`。不折两行。

### E4 下一步条（next）

- **用途**：每页顶上一句「现在该做什么」加一个主动作。它替换现在的 `css.stageBar`（stageHint + 警告 + 主按钮）。
- **规格**：
  - 容器：padding 11px 14px，圆角 12，背景见下方「bg-l2 映射不上」，下边距 16。flex，`align-items:center`，gap 12。
  - 左边 `.say`：第一行 13px/600，第二行 12px `label-secondary`。
  - 右边：E5 动作按钮。
  - 警示态（`.warnish`，人工评估判官缺席等）：背景换 `state-warn-tertiary`。
- **token**：背景用 `markdown-code-block`（最近替代，见 §三）；警示态用 `state-warn-tertiary`；文字 `label-primary / label-secondary`。
- **明暗**：自动，但替代色暗色下比 v5 更深一档（#1b1b1c 对 #232324），要在暗色截图里确认条和底能分开；分不开就加 1px `border-l1`。
- **400px**：改纵向排列，按钮 `align-self:flex-start`，不拉满宽。

### E5 按钮

- **用途**：所有动作。v5 只有三种：描边（默认）、黑色主按钮（pri）、ghost 文字链（用于换、次要取消）。另有 `.ai` 前缀表示「交给 agent」。
- **规格**：
  - 默认 v5 `.btn` = 宿主 `Button variant="outline" size="sm"`。宿主 sm 是 28px 胶囊，v5 约 28px 高、圆角 10，视觉等价，不自造按钮。
  - 主按钮 = `variant="primary"`：每页至多一个，就是 E4 里那个。
  - ghost 只留给「换」「取消」「放弃终评」这类低权重动作。放弃终评文字色用 `state-error-primary`。
  - 危险确认仍走现有 Modal。
  - v5 `.sm`（22px，12px 字）用于列表行内与提醒行内：宿主没有更小的尺寸，用 `size="sm"` 加一个 className，只压 padding 和字号（2px 9px / 12px，圆角 8）。
  - `.ai` 前缀：7px 旋转方块，`state-business-primary`，作为 Button 的 `icon` 传入，不改 Button 本体。
- **token**：宿主 Button 自带 `--dsw-alias-button-*` 家族，插件不重着色。`.ai` 用 `state-business-primary`。
- **明暗**：宿主自带。
- **400px**：按钮组 `flex-wrap: wrap`，gap 6；主按钮不换行（`white-space:nowrap`）。T79 记过的「批准并启动」折两行，就是缺这一条。
- **根因**：宿主 `Button` 默认 variant 是 `ghost`。现有 62 处 `<Button>` 没写 variant，于是都是裸文字。第二阶段逐处补 `variant`（见 §六）。

### E6 状态胶囊（pill）

- **用途**：实验状态、检查项结果、槽位、来源。它替换现在 `parts.tsx` 的 `Chip`（`css.chipTag` + `data-tone`）的外观，接口不变。
- **规格**：12px，line-height 20px，padding 0 7px，圆角 6。可带 `.dot`（6px `currentColor` 圆点，gap 5）。
- **tone 映射**：

  | tone | 背景 | 文字 |
  |---|---|---|
  | neutral | `bg-l2` 替代色 | `label-secondary` |
  | ok | `state-success-tertiary` | `state-success-primary`（浅色）；见 §三 ok-ink |
  | run | `state-business-tertiary` | `state-business-primary` |
  | warn | `state-warn-tertiary` | `state-warn-label` |
  | bad | `interactive-bg-hover-danger` | `state-error-primary` |

- **明暗**：自动。warn 文字暗色偏差见 §三。
- **400px**：不换行，`white-space:nowrap`。

### E7 段标题（sec）

- **用途**：页内每一段（要回答的问题、比什么、用哪些题……）。它替换现在的 `Section`（`reportSection / sectionTitle / sectionMeta`）外观。
- **规格**：标题 13px/600 `label-primary`；同行副注 `.h5s` 12px/400 `label-tertiary`，gap 8；标题下 8px 到内容；段与段 16px。**段不再套边框卡片**：v5 的段是裸的，卡片（E9）只在确实需要成组的地方用。
- **token**：`label-primary`、`label-tertiary`。
- **400px**：副注折到第二行。

### E8 表格

- **用途**：比什么、逐条判据、检查项、题集列表、条件表等所有表。
- **规格**：
  - 整体：`border-collapse:collapse; width:100%`，13px，`font-variant-numeric: tabular-nums`。
  - `th`：12px/400 `label-tertiary`，padding 6px 10px，下线 1px `border-l2`，nowrap。
  - `td`：padding 8px 10px，下线 1px `border-l1`，最后一行无线。**没有竖线、外框和斑马纹**。
  - 差异格 `td.diff`：只给不同的那一格上背景 `state-warn-tertiary`，不整行上色。
  - 行悬停：可点的行用 `interactive-bg-hover`。
- **token**：`border-l1`、`border-l2`、`label-tertiary`、`state-warn-tertiary`、`interactive-bg-hover`。
- **现状差异**：
  - eval `.reportHead / .reportRowHead / .reportTd` 是四边 `border-l2`，属于满格。
  - datasets `.table` 的表头线用 l2、行线用 l3，行线比表头线还重，和 v5 相反。
- **400px**：表 wrapper 横向滚动，首列 `position:sticky; left:0`（背景 `bg-base`），这样滚动时仍能看到是哪一行。

### E9 卡片（box）

- **用途**：成组的信息，比如「要回答的问题」、提醒、题集详情的两栏。
- **规格**：
  - 外框：1px `border-l2`，圆角 12，背景 `bg-base`。
  - 头部 `.bh`：padding 9px 14px，下线 `border-l2`，h4 13px/600，右侧可放 E5 小按钮。
  - 体 `.bb`：padding 12px 14px。
  - 键值 `.kv`：`grid-template-columns:max-content 1fr`，gap 4px 16px；dt `label-tertiary`。
- **token**：`border-l2`、`bg-base`、`label-tertiary`。
- **400px**：`.kv` 改单列（dt 在上，dd 在下，dd 下边距 6）。

### E10 结论卡（verdict）

- **用途**：结果对比页第一屏。对应 `ReportPage.ConclusionCard` 与 `.conclusionCard / conclusionHead / conclusionActions`。
- **规格**：
  - 外框：1px `border-l2`，**左 3px 色条**，圆角 12，padding 14px 16px。
  - 色条按结论 tone 取色：
    - 暂时不能下结论 / 降级：`state-warn-primary`
    - 有结论：`state-success-primary`
    - 评估不成立：`state-error-primary`
  - 顶部人工标记横幅 `.hmark`：左 3px `state-warn-primary`，背景 `state-warn-tertiary`，圆角 0 6 6 0，13px，下一行 12px `label-secondary` 写出处。
  - 标题 15px/600，同行接来源 12px `label-tertiary`。
  - 分数：`b` 24px/600，下注 12px `label-secondary`；缺分（未判）用 `label-caption`。
  - 理由列表：× 用 `state-error-primary`，! 用 `state-warn-label`。
  - 动作行：E5 描边按钮，gap 8，「让 agent 写分析初稿」带 `.ai` 前缀。
  - **校验 / 导出 / 分析初稿移到卡外**，作为 3 条 E11 折叠行放在页底。现在校验只是卡里的一个小胶囊。
- **token**：`border-l2`、`state-warn-primary`、`state-warn-tertiary`、`state-success-primary`、`state-error-primary`、`state-warn-label`、`label-secondary`、`label-tertiary`、`label-caption`。
- **400px**：分数块纵排，动作按钮 wrap。

### E11 折叠行（fold）

- **用途**：高级设置、原始计划 JSON、校验原文、实验有效性校验、导出与来源、分析初稿、评分者一致性、已归档。
- **规格**：
  - 行：上线 1px `border-l2`，padding 9px 0，13px `label-secondary`。
  - 前缀 `›`（展开时旋转 90°）用 `label-tertiary`。
  - 右侧摘要 `.n`：`margin-left:auto`，12px `label-tertiary`。
  - 连续几条共用上线，最后一条加下线。**不套边框卡片**：现在 `.reportFold` 和「评分者一致性」是带外框的卡。
  - 用原生 `<details>/<summary>`，隐藏默认三角。
- **token**：`border-l2`、`label-secondary`、`label-tertiary`。
- **400px**：右侧摘要折到第二行（`flex-wrap`），缩进与标题对齐。

### E12 分段控件（seg / seg2）

- **用途**：
  - seg 是紧凑的判定型，用于成立/不成立、题集可见性、规模 1/3/5。
  - seg2 是视图切换型，用于本会话发起/全部、盲评/显示组名、提交的报告/判定证据。
- **规格**：
  - seg：外框 1px `border-l2`，圆角 6。项 padding 0 7px，line-height 20px，12px。选中项背景 `button-primary-fill`、文字 `label-primary-foreground`。
  - seg2：背景 `bg-l2` 替代色，padding 2，圆角 8。项 padding 2px 10px，圆角 6。选中项背景 `bg-base`，阴影 `0 0 0 1px border-l2`。
  - 语义都是 `role="radiogroup"` 加 `aria-checked`，方向键切换。
- **宿主件**：0.1.5 没有 SegmentedControl 原件（0.1.7 才有）。插件必须自带一个薄实现。
  - eval 放 `parts.tsx`，datasets 放自己的 `parts.tsx`，两边各一份，不互相 import。
  - 现有 `.segmented`（LabView.module.css:388）改造成这两种。
- **token**：`border-l2`、`button-primary-fill`、`label-primary-foreground`、`bg-base`、`label-secondary`。
- **400px**：不换行；项多时整条横向滚动。

### E13 列表分组与行（listgrp / xrow）

- **用途**：实验列表，分组为需要你处理 / 运行中 / 已完成，以及折叠的已归档。
- **规格**：
  - 组标题 13px/600，后接计数 `label-tertiary`，上边距 16，下边距 4。
  - 行：`grid-template-columns: minmax(0,2.2fr) minmax(0,1.3fr) max-content max-content`，gap 12，padding 8px 10px，圆角 10，悬停背景 `interactive-bg-hover`，整行可点。
  - 四列依次是：
    1. 名字 500，下一行 12px `label-secondary` 写问题或一句话；
    2. meta，12px `label-secondary`；
    3. E6 胶囊；
    4. E5 小按钮，就是行内主动作。
  - 行间**没有分隔线**，现在的 `.listTable` 有线。
  - 已归档是底部的 E11 折叠行。测试和冒烟运行的归档是数据口径，第二阶段只负责折叠行的外观。
- **token**：`interactive-bg-hover`、`label-secondary`、`label-tertiary`。
- **400px**：v5 在 760 处去掉 meta 列，列变为 `minmax(0,1fr) max-content`，胶囊移到名字行尾。这里照做，断点用 view 的容器查询，不用窗口宽。

### E14 空态

- **用途**：本会话发起为空、无运行、题集未登记等。v5 没有空态场景，这里从 v5 的语言推出来。
- **规格**：现在的 `.emptySeat` 是虚线框，改为**无框**：
  - 13px/600 一句话，12px `label-secondary` 一句下一步；
  - 下面是 E5 按钮（有主动作时用 primary）；
  - 上下 padding 24px，左对齐在版心内，不居中漂浮。
- **token**：`label-primary`、`label-secondary`。
- **400px**：同。

### 另：场景专属件（只在一处用，不抽共用）

| 件 | v5 | 用在哪里 |
|---|---|---|
| `.crit` 判据行 | `grid 1fr auto auto`，12px | 人工评估（每行一个 E12 seg） |
| `.cells` 格子 | `auto-fit minmax(210px,1fr)` | 运行记录 |
| `.tl` 时间轴 | 8px 点：当前 `state-business-primary` 加 3px `state-business-tertiary` 光圈；未到 `border-l4` | 运行记录详情 |
| `.bars` 柱 | 6px 高，底 bg-l2 替代色，柱 `label-secondary` | 结果对比「效率」。现在是品牌蓝满格，v5 是灰柱 |
| `.cmp` / `.pane` / `.subtabs` | 两栏，窄时一栏；pane 头用 bg-l2 替代色；subtabs 当前项 2px `label-primary` 下划线 | 作答查看 |

## 三、token 映射表

| v5 变量 | 浅 / 暗 | 宿主 alias | 备注 |
|---|---|---|---|
| `--bg-base` | #fff / #151517 | `--dsw-alias-bg-base` | |
| `--overlay` | #e9ecf2 | `--dsw-alias-bg-overlay` | |
| `--b1..b4` | #0000000a / 1a / 1f / 29 | `--dsw-alias-border-l1..l4` | |
| `--l1` | #0f1115 / #f9fafb | `--dsw-alias-label-primary` | |
| `--l2` | #61666b / #cfd3d6 | `--dsw-alias-label-secondary` | |
| `--l3` | #81858c / #adb2b8 | `--dsw-alias-label-tertiary` | |
| `--cap` | #adb2b8 / #81858c | `--dsw-alias-label-caption` | |
| `--pri` / `--pri-ink` / `--pri-hover` / `--dim` | | `button-primary-fill` / `label-primary-foreground` / `button-primary-hover` / `button-primary-dimmed` | |
| `--link` | #4176e6 / #679efe | `--dsw-alias-link` | |
| `--biz` / `--biz-3` | | `state-business-primary` / `state-business-tertiary` | |
| `--hover` / `--active` | | `interactive-bg-hover` / `interactive-bg-active` | |
| `--ok` / `--ok-3`（= `--add`） | | `state-success-primary` / `state-success-tertiary` | |
| `--warn` / `--warn-3`（= `--diffbg`） | | `state-warn-primary` / `state-warn-tertiary` | |
| `--warn-ink` | #dd8629 / #f7ad31 | `state-warn-label` | **暗色部分失配**：宿主两档都是 amber-600；v5 暗色是 amber-400 = `state-warn-secondary`。建议用 `state-warn-label`，暗色若读不清再在暗色下改指 `state-warn-secondary` |
| `--err` | | `state-error-primary` | |
| `--err-3`（= `--del`） | #ec13130d / #f25a5a26 | `interactive-bg-hover-danger` | 值精确相等，语义上借用 |
| 字体 | | `--dsw-font-family`，代码 `--ds-font-family-code` | 字号 token `--dsw-font-xxs-12` / `xs-13` / `s-14` / `l-20` 存在，可用可不用；与现有 CSS 一致，写 px 也行 |
| 阴影 | | `--dsw-shadow-lv1..3` | |

**映射不上的：**

| v5 | 值 | 最近替代 | 建议 |
|---|---|---|---|
| `--bg-l2` | #f6f7f9 / #232324 | `markdown-code-block`（#f9fafb / #1b1b1c）、`bg-module-platform`（#f5f6f7 / #353638）、`markdown-code-block-banner`（#f9fafb / #2c2c2e） | 用 `markdown-code-block-banner`：浅色几乎等值，暗色 #2c2c2e 比 v5 亮一档但能和底分开；在插件 `.view` 上定义局部变量 `--dsh-eval-surface-2`，一处改全改 |
| `--ok-ink`（浅） | #16a34a（green-600） | `state-success-primary`（green-500）；暗色 #4ed17e = `state-success-secondary` | 浅色用 `state-success-primary`，暗色 `state-success-secondary` 需要两档切换；宿主没有 success-label |
| `--bg-side` | #f8f9fa | 宿主侧栏自己的色 | 只在交互稿的假侧栏里用，插件用不到 |

**插件现有 CSS 引用了宿主不存在的 token**（0.1.5 与 0.1.7 主题都没有定义），属于当前缺陷，第二阶段一并换掉：

- `--dsw-alias-bg-l2` 共 7 处，解析为透明：
  - `AnswerView.module.css:59`
  - `LabView.module.css:188 / 583 / 2053 / 2083 / 2319`
- `--dsw-alias-state-danger-label` 共 3 处，颜色被继承：`LabView.module.css:2041 / 2553 / 2612`。改为 `state-error-primary`。

T63 验收时纠过 ui-spec §九 里的四个假 token 名，这两个是漏网的。

## 四、场景 × 共用件

✓ = 该场景用到这个件；空 = 不用。「现状」列写实现与 v5 差得最远的一处。

| 场景 | E1 版心 | E2 页头 | E3 阶段条 | E4 下一步 | E5 按钮 | E6 胶囊 | E7 段 | E8 表 | E9 卡 | E10 结论卡 | E11 折叠 | E12 分段 | E13 列表 | E14 空态 | 现状最大差距 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 列表 | ✓ | ✓（列表式） | | | ✓ 主按钮新建、行内 sm | ✓ | | | | | ✓ 已归档 | ✓ seg2 | ✓ | ✓ | 22 行进「需要你处理」、行内动作是裸字、满宽 |
| 实验设计方案段 | ✓ | ✓ | ✓ | ✓ | ✓ 换（ghost）、让 agent 改（ai） | ✓ | ✓ | ✓ 比什么（diff 格） | ✓ 问题、怎么判（kv） | | ✓ 高级设置、原始 JSON | ✓ 规模 1/3/5 | | | 规模是裸输入框 + 游离「数字」标签；差异整行色带 |
| 就绪段 | ✓ | ✓ | ✓ | ✓（主按钮 = 第一条修法；「批准并启动」disabled） | ✓ sm + ai | ✓ dot | ✓ | ✓ 检查项 | ✓ 提醒 | | ✓ 校验原文 | | | | 已启动实验只剩一个「环境就绪」胶囊；未启动态本数据集拍不到（见 §八） |
| 结果对比 | ✓ | ✓ 含问题行 | ✓ | | ✓ 四个描边动作 | ✓ | ✓ | ✓ 逐条判据（只横线） | | ✓ | ✓ 校验 / 导出 / 分析初稿 | | | | 平卡、满格表、效率柱为品牌蓝 |
| 人工评估 | ✓ | ✓ | ✓ | ✓ warnish（判官缺席） | ✓ 提交终评 pri、带标记提交、不做终评、放弃终评（ghost 红） | ✓ | ✓ | | ✓ 每份作答一张 | | ✓ 评分者一致性 | ✓ 成立 / 不成立、seg2 盲评 | | | 队列侧栏 + 多层嵌套卡 + 自由文本框；作答区是 60vh 内滚动 |
| 运行记录 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | | ✓ 实验卫生 | | | ✓ | 格子与时间轴另有专属件（§二末表） |
| 作答查看 | ✓ | ✓（← 运行 返回式） | | | ✓ | ✓ | | | | | | ✓ seg2 | | | 两栏 pane 与 subtabs 外观 |
| 题集列表 | ✓ | ✓（「已登记的仓库」+ 登记一个仓库…） | | | ✓ | ✓ | ✓ | ✓ | | | | ✓ 可见性 seg | | ✓ | 表线轻重反了 |
| 题集详情 | 两栏树 + 预览，不套 E1（见注） | ✓ 返回式 | | | ✓ | ✓ | | ✓ 作答记录 | ✓ 两栏 cmp | | | | | ✓ | 预览区读宽度应受 E1 约束 |
| 登记 | ✓ | ✓ 返回式 | | | ✓ 主按钮登记 | | ✓ | | ✓ | | | ✓（chipGroup → seg） | | | v5 无此场景，按 E7 + E9 + E5 组合 |

注：题集详情是 IDE 式两栏（树 + 预览），树栏宽度不该跟着版心收。E1 只约束预览栏里的阅读宽度（`.previewScroll` 内部）。

## 五、「底部被输入框压住」诊断

**机制**：两个 view 都打了 `data-conversation-composer-overlay`，宿主因此：

- 把 composer seat 改成 `position:absolute; bottom:0`，浮在 `.scrollBody` 上；
- 把 view 区域设为 `overflow:hidden`，由 view 自己出滚动容器；
- 在 scroller 上写 `--dsh-composer-height`（seat 的 offsetHeight，随 ResizeObserver 更新）。

0.1.5 与 0.1.7 同形，见 `ui-conversation` ConversationRoot.module.css 的 `.scrollBody:has([data-conversation-composer-overlay])` 与 ConversationContent.tsx 的 seat 观察器。

插件侧对应的 clearance 如下：

- eval：`.view` 定义 `--dsh-eval-bottom-clearance: calc(var(--dsh-composer-height,152px) + 16px)`，唯一的外层滚动容器 `.body` 用它做 padding-bottom（LabView.module.css:208–214）。
- datasets：`--dsh-datasets-bottom-clearance` 用在树、预览两个滚动栏上（DatasetsView.module.css:134 / 424 / 444）。

轨迹 tab 用的也是这个形状（`--dsh-trajectory-bottom-clearance`）。

**实测**：临时实例 3183，0.1.5-rc.1。把 view 里所有可滚动元素滚到底后，读 computed style 和几何：

| 视口 | 场景 | `--dsh-composer-height` | `.body` padding-bottom | seat 顶 | 滚到底后 |
|---|---|---|---|---|---|
| 1440×900 | 列表 | 128px | 144px | 772 | 最后一行下沿 756 |
| 1440×900 | 结果对比 / 人工评估 | 128px | 144px | 772 | 截图核对：最后一段（导出与来源 / 评分者一致性）约 747，在输入框之上。脚本读到结果页 lastContentBottom 891，是一个不可见元素，截图无遮挡 |
| 1024×700 | 列表 / 结果对比 / 人工评估 | 128px | 144px | — | 截图核对：最后一段都在输入框之上 |
| 400×800 | 列表 | 168px（chip 行折行后变高，变量跟着变） | 184px | — | 截图核对：无遮挡 |
| 400×800 | 结果对比 / 人工评估 | 同上随 composer 变化 | = composer + 16px | — | 截图核对：无遮挡 |
| 三个视口 | 运行记录、题集列表 | — | — | — | 内容不足一屏，不溢出 |

结论：**当前 main 上，三页滚到底时最后一段都在输入框上方 16px，复现不出「压住」**。截图见 `*-impl-bottom-<w>x<h>.png`。

**最可能的来源**：判读的是**滚动顶部**的静态截图。

- overlay 模式下，内容从输入框底下滚过去，这是设计行为，与对话页相同。
- 视口高度不够一页时，第一屏的最后一段本来就在输入框下面，要滚才出来。
- 页面拉满 1158px 宽而输入框只有 774px 宽、居中，两侧的内容露在输入框旁边、中间被挡住，更像「压住」。E1 版心与输入框同轴后，这个观感会消失。

**第二阶段仍要做的两处加固**（都是小改）：

1. **内滚动容器没有 clearance**。人工评估作答区 `.judgeMaterial` 设了 `max-height:60vh; overflow-y:auto`（LabView.module.css:1549）。它是页中间的第二个滚动容器，滚轮在里面先被它吃掉，页面滚不动，用户会以为底部内容「出不来」。
   - 另外 `.drawerBody`（1233）、`.newForm`（1657）、`.pre`（634）是同样的形状。
   - 建议人工评估改成 v5 的紧凑表后取消这层内滚动，整页只剩一个滚动容器。
   - `.pre`（原文块，320px）保留，它不贴底。
2. **窄 view 下 datasets 的 `.body` 变成滚动容器**（容器查询 `max-width:699px`，DatasetsView.module.css:366），自己却没有 clearance（实测 padding-bottom 0）。
   - 目前靠 `.previewScroll` 的 padding 撑住，碰巧没被压。
   - 应把 clearance 移到真正滚动的那一层，否则预览换成短内容就会贴底。

**不做的**：不改宿主，不去掉 overlay opt-in。去掉的话，输入框会回到文档流里，占掉固定高度，与对话 tab 不一致。

## 六、第二阶段施工图

按 T83 文案的顺序：列表 → 设计 → 结果对比 → 人工评估 → 运行记录 → 作答 → 题集。先落共用件，再逐场景套用。两包各自一份共用件，不互相 import。

### 6.1 共用件落点

| 件 | eval | datasets |
|---|---|---|
| E1 版心 | `LabView.tsx`：`css.body` 内加 `<div className={css.column}>`；`LabView.module.css` 新增 `.column` | `DatasetsView.tsx`：列表、登记两处包 `.column`；详情只在 `.previewScroll` 内限读宽 |
| E2 页头 | `LabView.tsx` L1017 起的 `css.bar` 行重排为 `PageHead`（新函数组件，放 `parts.tsx`），列表与详情两种形态 | `DatasetsView.tsx` 顶部 binding bar 与详情返回行、`DatasetDetail.tsx` 头部，各自 `parts.tsx` 里一个 `PageHead` |
| E3 阶段条 | `LabView.tsx` L1076 `css.pages / pageTab / pageDot` → `StageBar`（`parts.tsx`），点色沿用 `stageTone` | — |
| E4 下一步条 | `LabView.tsx` L1099 `css.stageBar` → `NextBar`（`parts.tsx`），`stageAction` 结果填右侧 | — |
| E5 按钮 | 全包逐处补 `variant`，缺省处（总数/缺省）：ReportPage 15/11、RunsPage 11/9、JudgingPage 8/7、LabView 9/6、DesignPage 5/4、NewExperimentDialog 5/4、AnswerView 3/3、ConditionsPage 3/2、ExportDialog 3/1、DraftCard 1/1、parts 1/1（eval 共 49 处）；`.ai` 前缀做成 `AiMark` 图标 | DatasetsView 9/6、RegistryList 5/4、RegisterForm 3/2、SkeletonForm 2/1（共 13 处） |
| E6 胶囊 | `parts.tsx` `Chip` 的 `css.chipTag`（LabView.module.css:54）改尺寸与 tone 色；接口不动 | `parts.tsx` `Chip`、DatasetsView.module.css:898 |
| E7 段 | `parts.tsx` `Section`（`reportSection / sectionTitle / sectionMeta`）去框 | 各段标题的 CSS |
| E8 表格 | `.reportHead / .reportRowHead / .reportTd`（1457 起）去竖线；`.itemsTable`（2424）、`.compareTable`（2390）、`.matrixTable`（966）、`.cellsTable`（1127）、`.paramTable`（1862）、`.diffTable`（814）统一到一个 `.t` 基类；`ConditionsPage.Diff` 与 `DesignPage.ItemsTable` 的 diff 标记改到格上 | `.table`（449）线的轻重对调；`RegistryList.SetRow`、`DatasetDetail.AnswerRecord` |
| E9 卡片 | `DesignPage.QuestionSection / HowJudged / ReadinessChecklist` 的提醒块 | `DatasetDetail` 两栏 |
| E10 结论卡 | `ReportPage.ConclusionCard`（L415）与 `.conclusionCard / conclusionHead / conclusionActions`（576、2474、2556）；`ValidityAside`（L535）移出卡外成 E11 | — |
| E11 折叠行 | `ReportPage.Fold`（L509）与 `.reportFold*`（2563–2616）去框；`DesignPage.AdvancedSection`、`JudgingPage` 评分者一致性、`LabView.ArchiveLegacy`（L1484）、`Grid.Hygiene` 统一用它 | 如有 |
| E12 分段 | `parts.tsx` 新增 `Seg` / `Seg2`；替换 `ExperimentList` L1544 的 `.segmented`（388）、`JudgingPage.CriterionRow` 的成立/不成立、AnswerView 的盲评切换；`DesignPage.NumbersField / ScaleSection` 的规模改为 1/3/5 seg（估算数字等数据面，记在下轮） | `parts.tsx` 新增同名薄实现；`RegisterForm` 的 `.chipGroup` 与 RegistryList 的可见性 |
| E13 列表 | `LabView.ExperimentList`（L1521）、`ExperimentRowLine`（L1406）、`.listTable / listGroup / listGroupHead`；`RowMenu`（L1355）留作行尾「⋯」 | — |
| E14 空态 | `parts.tsx` `EmptyState`（`.emptySeat` 去虚线框） | `parts.tsx` `EmptyState` |
| 字号基准 | `.view` 的 `font-size:12px; line-height:18px` 改 13px / 20px，并逐处核实显式写了 12px 的注释类文字不受影响 | DatasetsView 同 |
| 假 token | §三 列的 10 处 | — |
| 底部加固 | §五 两处：`.judgeMaterial` 去内滚动（随人工评估改版）；无 | `@container datasets-view (max-width:699px)` 里 `.body` 补 clearance |

### 6.2 逐场景

| 顺序 | 场景 | 文件 | 要点 |
|---|---|---|---|
| 1 | 列表 | `LabView.tsx`（ExperimentList / ExperimentRowLine / ArchiveLegacy） | E2 列表式页头，seg2 移进页头；分组用 E13；已归档 E11 放底；行内动作 sm outline |
| 2 | 实验设计 | `DesignPage.tsx`、`ConditionsPage.tsx`（ConditionsTable / Diff） | 段去框；比什么表 E8 + diff 格；规模 E12 seg；就绪段 E8 检查项 + E9 提醒 + E4 |
| 3 | 结果对比 | `ReportPage.tsx` | E10；逐条判据 E8；效率柱改灰；三条 E11 放底 |
| 4 | 人工评估 | `JudgingPage.tsx`（CriterionRow / ScoringBlock / ClosureExits / Stats） | 每份作答一张 E9 + `.crit` 行 + E12 seg；E4 warnish；收尾四个出口按 E5 分主次；**队列侧栏去不去是信息结构问题**，v5 没有侧栏，本文不定，第二阶段开工前请协调者裁 |
| 5 | 运行记录 | `RunsPage.tsx`、`Grid.tsx` | `.cells` 格子、`.tl` 时间轴、实验卫生 E11 |
| 6 | 作答查看 | `AnswerView.tsx` + `AnswerView.module.css` | `.cmp / .pane / .subtabs`；seg2 盲评；400 下单栏 |
| 7 | 题集 | `DatasetsView.tsx`、`RegistryList.tsx`、`DatasetDetail.tsx`、`RegisterForm.tsx` | E2 / E8 / E12 可见性；登记表 E7 + E9 |

每场景完工后按附录重拍成对截图（1440 明、暗、400），交互稿作者与协调者对照 v5 看过再进下一场景。

## 七、截图（第一阶段基线）

目录 `~/.dsh/scratch/t83-shots/phase1/`，按场景成对：

- v5：`<场景>-v5.png`、`<场景>-v5-dark.png`。截的是交互稿对应 `#hash` 的 `#stage .app`，含假侧栏，宽 848。
- 实现：`<场景>-impl-light.png`、`<场景>-impl-dark.png`（1440×1600）、`<场景>-impl-400.png`（400×1600，浅色）。
- 底部：`<场景>-impl-bottom-<w>x<h>.png`（列表 / 结果 / 人工评估 / 运行记录 / 题集列表 / 题集详情 × 1440×900、1024×700、400×800，滚到底）。

| 场景 | 实现文件名前缀 | v5 hash | 备注 |
|---|---|---|---|
| 列表 | `list` | `#list` | |
| 实验设计方案段 | `plan` | `#plan` | |
| 就绪段 | `ready` | `#ready` | 实现侧是已启动实验的设计页滚到就绪段，只有「环境就绪」胶囊 |
| 运行记录 | `run` | `#run` | |
| 结果对比 | `result` | `#result` | |
| 人工评估 | `judge` | `#judge` | |
| 作答查看 | `answer` | `#answer` | |
| 题集列表 | `lib-list` | `#lib` | v5 的 lib 场景把列表与详情画在一页，题集详情对照同一张 |
| 题集详情 | `lib-detail` | （同 `lib-list-v5`） | |
| 登记 | `register` | 无 | v5 没有登记场景 |

## 八、对 v5 的疑点与和宿主不合的地方

1. **版心宽度**：约 606px 是交互稿画布排出来的，不是设计值。本文建议用宿主内容轴（1440 下 742px，与输入框同轴），比 v5 宽约 140px。若交互稿作者坚持 600，要写成插件自定的 `max-width`，这样会和输入框错开。请交互稿作者定。
2. **`bg-l2` 无宿主 token**：v5 的次级底色在下一步条、seg2、pane 头、柱底都用到。替代色暗色下差一档，见 §三。
3. **0.1.5 没有分段控件原件**：两包各自带薄实现，将来宿主线升到 0.1.7 后可换成宿主的 `SegmentedControl`，记为退役项。
4. **题集没有登记场景，也没有空态场景**：本文从 v5 的语言推出，不算对齐失败。
5. **warn-ink 暗色失配**：宿主 `state-warn-label` 两档同值，v5 暗色更亮。
6. **人工评估的队列侧栏**：v5 没有侧栏。去掉它会改变「一次看一道题」的导航方式，已超出纯视觉，见 §6.2 第 4 行。
7. **规模 1/3/5 的估算数字**：v5 在 seg 旁给预计时长和 token，数据面还没有（T79 P2-4 记为下轮）。第二阶段只做 seg，估算位留空或不显示。
8. **本机数据拍不到的场景**：3171 账本拷贝里只有 pilot-d-preset 一个真实验（评估中），没有草稿、未启动、已完成的实验。实验设计的「未启动」形态、就绪段的阻塞项清单、结果对比的「有结论」绿色条，第一阶段都没有实拍基线；第二阶段要么在临时 home 里起一个草稿，要么用组件级截图补。
9. **正文 12px 对 13px**：`.view` 统一压到 12px 是 T35a 的有意选择（见文件头注释）。对齐 v5 要整体升到 13px，行高和密度都会变，请协调者确认。

## 九、第二阶段：裁决与落地

### 9.1 协调者裁决（2026-09-27）

| # | 疑点 | 裁决 | 落地 |
|---|---|---|---|
| 1 | 版心 | `min(100%, var(--dsh-chat-content-width, 720px))` | eval `.column` 包住页头、阶段条、下一步条和页面；datasets 列表页包 `.column`，详情保持两栏 |
| 2 | 人工评估侧栏 | 换成紧凑的「题目切换」行 | 属人工评估场景，第三阶段做 |
| 3 | 正文字号 | 两包正文 13px/20px，辅助文字 12px/18px | **取代 T35a 的 12px 基准**（`.view` 文件头注释同步改） |
| 4a | 分段控件 | 两包各带薄实现 | eval `parts.tsx` 的 `Seg` / `Seg2`（radiogroup，方向键移动）；datasets 目前没有分段控件的使用点，等题集场景需要时照抄 eval 那份 |
| 4b | ghost 按钮 | 保持中性色，不上品牌色 | 两包 62 处缺省 `variant` 的按钮补成 `outline`，工具性动作（刷新、返回）显式 `ghost` |
| 4c | 导航入口（看题面 / 看作答 / 看结论） | 文字链接，链接色 | `.navLink`；列表行的「看对比」「看运行记录」已改 |
| 4d | bg-l2 / warn-ink | 各包一个局部变量 | `--dsh-eval-surface-2` / `--dsh-eval-warn-ink` / `--dsh-eval-ok-ink`，datasets 同名 `--dsh-datasets-*`；暗色覆盖在 `body[data-ds-dark-theme]` 下 |
| 4e | 假 token | 修掉 | `--dsw-alias-bg-l2`、`--dsw-alias-state-danger-label` 两包清零；`tests/tones.spec.ts` 加断言防回退，另加「变量不许定义成自己」的断言（全局替换曾写出 `--x: var(--x)`，两包各中一次） |
| 4f | 规模估算 | 挪到第四阶段 | 预计时长、预计输出 token 两格显示「无估算」，下附一句为什么不猜 |
| 5 | 草稿基线 | 从 3171 只读 rsync 一份草稿进临时 home | `dsh-lean-vs-full-20260926-7204`；结论态第三阶段再定组件级截图还是手造账本 |
| 6 | 底部加固 | `.judgeMaterial` 去内滚动；datasets 窄屏 `.body` 补 clearance | 已做 |

### 9.2 共用件落点（实际）

- **E2 页头**：列表形态是「实验」+ seg2（本会话发起 / 全部）+「另有 N 个」+ 刷新 / 新建；详情形态是「← 回到列表」、标题、状态胶囊、刷新，问题句独占第二行。没有抽 `PageHead` 组件，就地写在 `LabView.tsx`。
- **E3 / E4**：阶段条和下一步条留在 `LabView.tsx` 原位改样式，没有抽组件；下一步条的第二行（提示、阻塞原因）是 `.stageSub`。
- **E7 段**：`Section` / `Block` 标题改成 `h5.sectionTitle`，段去框。
- **E8 表格**：`.table` 基类（th 12px、td 13px、行间 border-l1、末行无线、`td[data-differs]` 暖底）。比什么表沿用 grid 版 `.condHead / .condRow`，线与字号对齐 `.table`。
- **E11 折叠**：`parts.tsx` 新增 `Fold`，前缀 `›` 展开时转 90°；`.arrange`（高级设置）同样式。列表的「已归档」、设计页的计划网格和校验原文都改用它。
- **E13 列表行**：四列 grid（名字 / 进度 / 胶囊 / 动作），容器查询 `eval-view` ≤760 收成三列、≤480 收成两列；停滞行在窄屏保留进度说明。
- **就绪段**：v5 的「检查项」表（每组一行就绪 / 未就绪，阻塞项跟在后面，带修复按钮）+「提醒」卡（每条提醒一行，带后果说明与修复按钮）；全部重查只有一个按钮，放在表下；标题保留计数（`readiness.blockers` / `readiness.reminders`）。通过的校验条目收进「校验」折叠。

### 9.3 截图

目录 `~/.dsh/scratch/t83-shots/phase2/`，命名同 §七。场景：`list`、`plan`（草稿的实验设计页）、`ready`（同页滚到检查项）、`plan-run`（已启动实验 pilot-d-preset 的设计页）、`lib-list`。驱动脚本是 scratch 里的 `phase2-driver.mjs`（`impl` / `v5` 两种模式，第二个参数给场景列表）。

### 9.4 与 v5 仍有的差距（第二阶段范围内）

- 比什么表没有每行的「换」和表下「＋加一组」「把作用域对齐」：数据面和动作都不存在，不属视觉。
- 用哪些题表没有「考什么」「满分」列和「看题面」链接：题面数据没有进行表。
- 「数字」表单（每格预算、判官采样）仍在规模段里；v5 把它们放进「高级设置」。挪动算信息结构，没动。
- 草稿的问题卡只有标题，没有「预期 / 怎么算回答了」两行：这份草稿的 plan 本来就没写。
- 下一步条的次按钮（v5「让 agent 改…」）没加：现有 `stageAction` 只给一个主动作。

## 十、第三阶段：先修项与后五个场景

### 10.1 第二阶段先修（提交 `1895e43c`）

| # | 裁决 | 落地 |
|---|---|---|
| 1 | 旧运行并进一个折叠 | 没关联实验的运行不再分进三组，统一收进列表底部的「旧运行（未关联实验）· N」折叠；「归档 N 条旧运行」只在折叠里出现一处，点了归档所有没归档的旧运行；行上的「旧」胶囊去掉 |
| 2 | 设计页下一步条按 v5 | 条上是 v5 的状态标题加一行说明，主按钮旁边加「让 agent 改…」（outline）；页底的回退按钮去掉，「跑完保留容器」挪进高级设置 |
| 3 | 判官不进比什么表 | 表只列选手；判官在「怎么判」里写明，就绪情况由检查项表负责 |
| 4 | 数字表单挪进高级设置 | 预算、判官采样数两个输入框和它们的说明挪进高级设置；没有归属的「数字」标签去掉 |
| 5 | 等宽只给 repo@commit、路径、JSON | 题目名、组名改用正文字体，题目名加粗；检查项名不加粗（`.checkName`，在 `a5aa7a17`） |
| 6 | 折叠缩进统一 | 高级设置的摘要行和其他折叠从同一缩进开始 |

### 10.2 后五个场景（提交 `a5aa7a17` eval、`4cf05d95` datasets）

- **结果对比**：结论卡不再挂有效性胶囊，有效性只在页底「实验有效性校验」折叠里（摘要行逐项打勾，坏项标红）；卡片左边 3px 竖线，结论成立用 ok 色，否则用 warn 色；人工标记按 v5 的 hmark 样式（左竖线 + warn 浅底）；分数行、效率条形图按 v5 比例（条 6px，名字列 64–120px，图宽上限 540px）；「让 agent 写分析初稿」前加菱形标记。结论态用的是临时 home 里 `pilot-d-preset` 的真实报告数据（暂时不能下结论，4 vs 0），没有手造账本，没有碰 3171。
- **人工评估**：侧栏队列换成内容列顶部一行紧凑的「题目切换」：标签、全部 / 未评 / 已评筛选、每道题一个切换钮（题名 · N 份作答，已评计数评完变绿）。作答占满内容列。判官缺席卡换成 v5 的琥珀色实底卡；评分块不再套一层边框；判据 id 用 `.itemName`。
- **运行记录**：卡片用 `auto-fit` 铺满内容列（两张卡各占一半），圆角 12，组名 14px，选中态是深色描边（v5），不用品牌色。
- **作答查看**：每列头圆角 12、组名 15px，列底补一格收口，整列读作一张卡；阶段文件直接排在列里，不再套代码块底色，标题降到 14–16px；「判官已判」绿、「仅脚本判定」琥珀（v5 的色）。
- **题集**：列表页的登记栏进内容列，是这一页的页头：计数作 16px 标题，「登记仓库」outline、「从旧绑定登记」ghost，登记表单在栏内展开，也在内容列里。详情页的栏保持通栏，因为详情的正文是通栏的目录树 + 预览两栏，栏要跟它对齐。仓库名 14px、题集名 600 字重、表内辅助字 12px。

### 10.3 截图

目录 `~/.dsh/scratch/t83-shots/phase3/`（先修项的列表 / 设计 / 就绪三图在 `phase3-fix/`）。v5：`result`、`judge`、`run`、`answer`、`lib-list`，明暗各一张；实现：以上五个加 `lib-detail`、`register`、`ready`，各有 light / dark / 400 三张。驱动脚本 `phase3-driver.mjs`，用法同 §9.3。

### 10.4 与 v5 仍有的差距（第三阶段范围内）

- **结果对比**：v5 把 D1–D4 合成一行、另有「维度」列；我们按判据逐行、按维度分组。合行要改报告的数据形状，不属视觉。v5 里不可比一侧的分数是灰的，我们没做。理由句的加粗开头没做：句子是整条 i18n 文案，要拆文案才能加粗。
- **人工评估**：v5 的评分是一张「判据 / 判官 / 你的终评」小表，每行一对成立 / 不成立；我们每条判据仍是一段（说明 + 草稿 + 证据输入框），因为宿主要求每条终评带证据。页上还叠着三句灰字说明（盲评说明、并排说明、作答视图自己的盲评句），v5 只有一句；测试钉着前两句的存在，合并留到文案调整时。
- **运行记录**：v5 选中卡片后下方展开的时间线（工作区就绪 / 阶段一 / 阶段二…）在我们这边是点卡片后才出的抽屉，这次没改它的样式。
- **作答查看**：代码块的「复制」横条和上方空白来自宿主的 `MarkdownText`，插件改不动；v5 的「代码改动 · 预览」段我们没有数据。
- **题集**：v5 在列表下直接展开一道题的「选手将看到 / 只有判官和探针看得到」两卡；我们的详情页是目录树 + 预览，结构不同，这次没动。列表下那句「一个仓库只登记一次…」说明没加。

## 十一、第三阶段裁决批（人工评估 · 作答查看 · 结果对比）

### 11.1 裁决落点（提交 `67255797`）

| 裁决 | 落点 |
|---|---|
| ① 评分区改紧凑表 | 每张作答卡一张三列表：判据（「B2 健壮性 · 权重 10」一行）· 判官（✓ / ✕ / 两者计数 / 未判）· 你的终评（`Seg` 成立 / 不成立）。证据框只在这一行选定后展开在行下，仍必填。取证口径与 llm-draft 样本收进点判据名展开的明细区。 |
| ② 删灰底说明框 | 「你在这里打的分只覆盖……」压成卡片底部一行小字（`judge.scoringMix`），重记提示同在这一行。 |
| ③ 说明只留一句 | 标题改「{题} · 盲评」，右侧一句 `answer.blindScoring`；`judge.blindNotice` / `judge.sideBySide` 两句删掉，测试改钉这一句。 |
| ④ 看作答与收尾层级 | 卡片头右侧「看作答」（展开并滚到这份的报告）。提交终评 primary；带标记提交 / 不做终评 outline；放弃终评红字按钮。「记第 N 份」是卡片右下 outline 小按钮。 |
| ⑤ 作答查看 tab | 标题下一排 tab：提交的报告 / 代码改动 / 过程 / 判定证据；卡片上的过程按钮和报告/证据 Seg 删掉。并排/单份、显示组名/盲评两组放右上；单份时多一组选哪份。代码改动没有数据时显示空态。 |
| ⑥ 长报告夹断 | 每列约 16 行（352px）夹断，底部渐隐 + 「展开全文」，各列各自展开。 |
| ⑦ 复制横条 | 只用本插件作用域内的主题 token：横条改用代码块自己的底色，与代码块合成一块。横条的 padding 写死在宿主组件里，不写宿主类名选择器就压不住，记入差距。 |
| ⑧ 结果对比 | 判据表里的 ✕ 改中性色（label-secondary）；理由句开头加粗（文案里用 `**…**` 标出，渲染时拆成 `<b>`）；不可比那一侧的分数置灰。 |

### 11.2 截图

`~/.dsh/scratch/t83-shots/phase3b/`：`judge` / `judge-pick`（选定一行后证据框展开）/ `answer` / `answer-single` / `answer-evidence` / `result`，各有 light、dark、400 三张，v5 对照图与第三阶段同源。

### 11.3 仍有的差距

- **结果对比 D1–D4 合成一行**：v5 把同一维度的判据合成一行、另起「维度」列；报告数据按判据逐行给出，合行要改报告数据的形状，这批不做。
- **「复制成 3 次的新实验」**：放到第四阶段。
- **代码块横条的留白**：横条的 padding（9px 14px）与 `pre` 的 16px 是宿主 CodeBlock 写死的，只能用 token 改颜色；要压留白得写宿主类名选择器，按裁决不做。
- **判官列**：v5 每行只有一个 ✓ / ✕；我们有多个判官样本时，意见一致显示一个符号，意见分裂显示「✓n ✕m」，没有样本显示「未判」。

## 十二、第四阶段（用哪些题 + 估算 · 题集详情 · 运行记录时间线）

### 12.1 顺手修的两处（提交 `fb0d92c1`）

- **人工评估表判据截断**：实测判官列、终评列本来就按内容定宽（335px 的卡片上三列是 196 / 24 / 91px），判据列拿的就是余下的 1fr。截得早是因为判据名一行就上省略号；改成 id、判据文字、权重连成一段可换行的文字，两行以后才省略，C2 这类 id 不再被拆开。
- **作答查看卡片**：正文顶上的「阶段 N / stageN.md」两行去掉，文件名挪到卡片头右侧，小字「stage1.md · stage2.md」；正文里的阶段标题保留。

### 12.2 落点

| 步骤 | 提交 | 落点 |
|---|---|---|
| 用哪些题 + 规模与花费 | `ae3e7f65` | 方案审阅多带两份数据：`items`（经 DatasetsFace 读钉住的题集，visible / verify / grading 三层显式点名：标题、层级、阶段数、容器、判据按 kind 计数、检查脚本数、满分 = 正权重之和、题面全文），`estimate`（mission 账本里所有 eval 运行、已完成的格子、当前 attempt 的 orchestrator 委派时长与输出 token，按「组 × 题」取均值，缺的题用该组均值补，某组一条都没有就不给估算）。设计页「用哪些题」一题一行，「看题面」展开全文；「规模与花费」给每组次数（1 / 3 / 5）、作答份数、预计时长、预计输出 token，下面一行写估算的来源。 |
| 题集详情改版 | `4f1067bb` | 题目标题改成内容栏顶上的面包屑「仓库 › 题集 › 题」，右侧小字「看的是 {ref} @ {commit}」，下面是 item.json 的元数据小药丸。「选手将看到」「只有判官和探针看得到」改成两张带标题栏的卡片：文件按路径内联列出，量表后面写判据条数，题集级共享文件按层合成一项「题集级 · N 个文件」；卡片底一行写可判性小结，没有检查脚本时标黄。卡片下方一行「用过这道题的实验」。 |
| 运行记录时间线 | `a8e9afca` | 小运行（≤ 12 条）点开的记录照 v5：标题「组 · 题 · 第 N 次」，一个框，左边是竖排阶段列表（圆点 · 阶段名 · 「已提交 stageN.md」· 时长；进行中那一步是蓝圈），右边是竖排的看作答 / 打开子会话 / 带原因重跑…（点开才出现类别、原因输入框和重跑按钮）。判定、参数、附件、判官轮次、尝试、探针、释放与导出都收进下面的「这条记录的全部细节」，默认折叠。大运行仍是侧抽屉，两边用同一套组件拼出来。 |

### 12.3 截图

`~/.dsh/scratch/t83-shots/phase4/`：`plan`（用哪些题 + 规模与花费）、`plan-run`、`lib-detail-item`（打开 P0-placeholder）、`run-pick`（点开 dsh-full），各有 light、dark、400 三张。v5 对照图 `plan-v5` / `lib-list-v5` / `run-v5`（明暗各一）已拷进同一目录。

### 12.4 仍有的差距（协调者已认可）

- **满分**：v5 写 10，真实量表的正权重之和是 100，显示的是真实值。
- **面包屑没有版本切换**：v5 的「@ commit」可以切换；现在只显示看的是哪个 ref 和 commit，切换仍在顶栏。
- **时间线不画待办步骤**：v5 把没跑到的阶段画成灰点；记录里只有账本的转移，计划的阶段数不在这条记录上，猜出来的待办行在重跑改了阶段以后会过时，所以只画实际走过的阶段。第一段未计时的「待起」不画。
- **按钮文案**：v5 写「看选手会话」，现在沿用已有的 `drawer.openSession`（打开子会话），维持不改。

### 12.5 第四阶段复核批（提交 `001f7e2f`、`b63f86df`、`3aa7d6ab`、`6aa4a84b`）

- **估算不外推**：只合计有过往作答的题。一道题要每个对比组都有样本才算覆盖，只有一个组答过的按未覆盖处理。
  - 全部覆盖：写「≈」。
  - 部分覆盖：大字写「≥」，下一行写明只含哪几道题（各几次作答）、哪几道没有过往作答、无估算。
  - 一道都没有：「无估算」。token 同样处理。
  - 测试：`plan-items.spec.ts` 钉住「部分覆盖时不外推」，`LabReview.client.spec.tsx` 钉住「≥」与说明行。
- **题集详情两张卡**：一行一个文件，路径等宽，右侧小字写大小或标注（「N 条判据」「题集级」）。两卡顶部对齐、等高，内容多在卡内滚动。「用过这道题的实验」只列最近 5 个，后接「等 N 个」可展开；「作答记录」只显示最近 5 组，其余收进「更早的作答记录 · N」。
- **时间线状态色**：已完成的阶段是 ok 色实心点，进行中是蓝圈，停下的是 danger 色；点与点之间一条细竖线。
- **截图**：`~/.dsh/scratch/t83-shots/phase4b/`，场景 `plan`、`plan-run`、`lib-detail-item`、`run-pick`，各有 light、dark、400 三张；v5 对照图同 12.3，已拷进同一目录。
- **设计取舍**：见 Agent Note `.agents/notes/implemented/feature/2026-09-27-t83-eval-datasets-visual-parity.md`（按钮变体、两包各一份 `Seg`、证据框选定后展开、估算不外推）。

## 附录 A：临时实例与重拍

- 实例：端口 3183；home 路径记在 `~/.dsh/scratch/t83-temp-home.txt`；pid 在该 home 的 `instance.pid`。
- 数据：从 3171 的 `~/.dsh-lab` 用 rsync 只读拷出，排除凭据、local-agent、日志、profiles、tarballs、watchdog 状态。home 内 `find` 查 token / cred / cookie 为空。
- 重装（改了代码之后）：

  ```sh
  export DSH_HARNESS=~/code/deepseek-harness-0.1.7-rc.1
  TH=$(cat ~/.dsh/scratch/t83-temp-home.txt)
  cd <worktree>
  pnpm --filter '@khorsheed/dsh-eval...' --filter '@khorsheed/dsh-datasets...' run build
  DSH_HOME=$TH PATH=~/.dsh-toolchains/rc-0.1.5-rc.1/node_modules/.bin:$PATH \
    sh profiles/web-eval/scripts/install.sh --source "$PWD" --fresh
  kill "$(cat $TH/instance.pid)"   # 先核 pid 是这个实例的
  cd $TH && umask 077 && DSH_HOME=$TH PATH=~/.dsh-toolchains/rc-0.1.5-rc.1/node_modules/.bin:$PATH \
    nohup dsh --profile web-eval --port 3183 --no-open > $TH/instance.out 2>&1 &
  echo $! > $TH/instance.pid
  ```

  重启后登录链接在 `$TH/instance.out` 里。打印时用 `sed 's/token=.*/token=***/'` 遮掉 token。登录一次后保存 playwright storageState（`$TH/pw-state.json`，chmod 600）。地址用 `127.0.0.1`，cookie 绑这个主机名。

- 首屏会弹「添加一个 API Key」（home 没有凭据），驱动脚本点「稍后配置」。

## 附录 B：截图与测量驱动

playwright 取自 harness 检出里的 `node_modules/.pnpm/playwright@1.61.1`。

```js
// screenshot + measurement driver (scratch; not product code)
const { chromium } = await import(process.env.HOME + '/code/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs');
const OUT = process.env.HOME + '/.dsh/scratch/t83-shots/phase1/';
const SESSION='用 harness 比较 lean 与 full', EXP='pilot-d-preset';
const b = await chromium.launch({args:['--no-proxy-server']});
async function open(p){
  await p.goto('http://127.0.0.1:3183/'); await p.waitForTimeout(3000);
  const later=p.getByText('稍后配置',{exact:true}); if (await later.isVisible().catch(()=>false)) { await later.click(); await p.waitForTimeout(600); }
  if (!(await p.getByText('实验室',{exact:true}).first().isVisible().catch(()=>false))) {
    const s=p.getByText(SESSION).first();
    if (!(await s.isVisible().catch(()=>false))) { const t=p.locator('button[aria-label*="侧"],button[aria-label*="idebar"]').first(); await t.click().catch(()=>{}); await p.waitForTimeout(800); }
    await s.click(); await p.waitForTimeout(2500);
  }
}
const tab = async (p,t)=>{ await p.getByText(t,{exact:true}).first().click(); await p.waitForTimeout(1500); };
const lab = p=>tab(p,'实验室');
const exp = async (p,page)=>{ await lab(p); await p.getByText(EXP,{exact:true}).first().click(); await p.waitForTimeout(1500); await p.getByText(page,{exact:true}).first().click(); await p.waitForTimeout(1800); };
const scenes = {
  list: async p=>{ await lab(p); await tab(p,'全部'); },
  plan: p=>exp(p,'实验设计'),
  ready: async p=>{ await exp(p,'实验设计'); const r=p.getByText(/就绪|校验/).first(); await r.scrollIntoViewIfNeeded().catch(()=>{}); },
  run: p=>exp(p,'运行记录'),
  result: p=>exp(p,'结果对比'),
  judge: p=>exp(p,'人工评估'),
  answer: async p=>{ await exp(p,'结果对比'); await p.getByText('并排看作答').first().click(); await p.waitForTimeout(1800); },
  'lib-list': p=>tab(p,'题集'),
  'lib-detail': async p=>{ await tab(p,'题集'); await p.getByText('harness-comparison').first().click(); await p.waitForTimeout(1500); },
  register: async p=>{ await tab(p,'题集'); await p.getByRole('button',{name:'登记仓库'}).first().click(); await p.waitForTimeout(1500); },
};
const measure = p=>p.evaluate(()=>{
  const view=document.querySelector('[data-conversation-composer-overlay]'); if(!view) return 'no view';
  const scrollers=[...view.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return /(auto|scroll)/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+2;});
  for(const s of scrollers) s.scrollTop=s.scrollHeight;
  const ed=[...document.querySelectorAll('textarea,[contenteditable=true],[placeholder],[data-placeholder]')].find(e=>((e.getAttribute('placeholder')||e.getAttribute('data-placeholder')||e.textContent||'')).includes('发消息'));
  let seat=ed; while(seat&&getComputedStyle(seat).position!=='absolute') seat=seat.parentElement;
  const vs=getComputedStyle(view);
  const res={vw:innerWidth,vh:innerHeight,composerVar:vs.getPropertyValue('--dsh-composer-height'),viewportVar:vs.getPropertyValue('--dsh-conversation-viewport-height'),
    clearance:vs.getPropertyValue('--dsh-eval-bottom-clearance')||vs.getPropertyValue('--dsh-datasets-bottom-clearance'),
    viewRect:(r=>[r.top|0,r.bottom|0])(view.getBoundingClientRect()),
    seat: seat?(r=>({top:r.top|0,h:r.height|0}))(seat.getBoundingClientRect()):null, scrollers:[]};
  for(const s of scrollers){const r=s.getBoundingClientRect();const cs=getComputedStyle(s);
    let last=0; for(const c of s.querySelectorAll('*')){const q=c.getBoundingClientRect(); if(q.height>0&&q.bottom<=r.bottom+1&&q.bottom>last) last=q.bottom;}
    res.scrollers.push({cls:String(s.className).slice(0,40),top:r.top|0,bottom:r.bottom|0,pb:cs.paddingBottom,maxH:cs.maxHeight,lastContentBottom:last|0});}
  return JSON.stringify(res);
});
const mode = process.argv[2];
if (mode==='shots400') {
  const ctx=await b.newContext({storageState:process.env.TH+'/pw-state.json',viewport:{width:400,height:1600},locale:'zh-CN',colorScheme:'light'});
  const p=await ctx.newPage();
  for (const [name,fn] of Object.entries(scenes)) {
    try { await open(p); await fn(p); await p.screenshot({path:OUT+name+'-impl-400.png'}); console.log('ok',name); }
    catch(e){ console.log('FAIL',name,String(e).slice(0,200)); await p.screenshot({path:OUT+name+'-impl-400-FAIL.png'}); }
  }
  await ctx.close();
}
if (mode==='measure') {
  for (const [w,h] of [[1440,900],[1024,700],[400,800]]) {
    const ctx=await b.newContext({storageState:process.env.TH+'/pw-state.json',viewport:{width:w,height:h},locale:'zh-CN'});
    const p=await ctx.newPage();
    for (const name of ['list','result','judge','run','lib-list','lib-detail']) {
      try { await open(p); await scenes[name](p); console.log('M',w,h,name,await measure(p));
        await p.screenshot({path:OUT+name+`-impl-bottom-${w}x${h}.png`}); }
      catch(e){ console.log('MFAIL',w,name,String(e).slice(0,200)); }
    }
    await ctx.close();
  }
}
await b.close();

// v5 截图（交互稿每个 hash 截 #stage .app，1440×1000，明暗各一张）：
//   V5=<交互稿 html 路径>，map = {list,plan,ready,run,result,answer,judge,'lib-list':'lib'}
//   for scheme of [light,dark]: page.goto('file://'+V5+'#'+id); page.locator('#stage .app').first().screenshot(...)
// 1440 明 / 暗的实现侧整页图用同一组 scenes，viewport 1440×1600，colorScheme 切换。
```
