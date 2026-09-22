# 文件/工作树共享预览内核（preview-kernel）

- **分类**：plugin（仓库内新增共享包 + 一条显式跨包边；非上游改动）
- **状态**：planned（能力清单已定稿，M1 待开工）
- **最后更新**：2026-09-23
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）+ `docs/`。**同一意图有两处预告，无重复提案**：① `proposals/closed/2026-08-26-local-files-browser.md:99` 在拆分 local-files 时明确写下「内容预览组件（HTML/Markdown/JSON/CSV/图片）从 worktrees 复制进包内（自包含，不跨包依赖；**共享预览层抽提是后续可能的优化，不在本批次**）」——本提案就是那条被推迟的后续，且该提案已 `done` 归档，按 README「done 是关闭不是开始新工作，后续增量走新提案」新建；② `.agents/notes/implemented/feature/2026-09-18-canvas-html-cards.zh.md:65` 已直接写「若要，归**共享渲染包**，不归画布」——第三个消费方已假定这个包存在。相邻但不同意图，不合并：`active/2026-08-21-file-view-html-rendering.md`（Tier0/Tier1 渲染能力本身，本提案把它的产物收进内核，互指见「实现记录」）、`active/2026-08-23-worktree-governance.md`（worktrees 的 git 能力，本提案只统一渲染面，不碰 git 面）、`active/2026-09-16-canvas-space.md`（消费方，本提案为其提供渲染面）。
- **官方依赖**：纯插件（零官方改动）。新增的是**仓库内**共享包与一条显式跨包边，不是上游契约扩展。若官方日后导出可复用文档渲染面，本提案转入 `closed（官方吸收）`，见「退休路径」。

## 目标

把「文件列表」（`packages/local-files`）与「工作树」（`packages/worktrees`）的**预览渲染与面板体验**收敛为一份实现——一处修复两边生效，两边的差异只允许来自**数据面**（git 状态 / diff / 提交 / 文件树结构），不允许来自**渲染**。

两条硬口径：

1. **统一后的能力是两边能力的并集，不是取其一。** 任何一边今天已有的预览能力，统一后两边都必须有。
2. **内核只做内容视图。** diff / 提交对比由 worktrees 以 render prop 传入；内核不引入任何 git 概念（用户 2026-09-23 裁定）。

## 现状（实测）

### 分叉史

| 时间 | 事件 |
|---|---|
| 2026-08-28 | `3df30448` local-files 从 worktrees 拆出为独立「工作区」tab（提案 `closed/2026-08-26-local-files-browser.md`） |
| 2026-09 | local-files 继续吃能力：`28f8d645` 滚动位置记忆、`a274514f` open-in-app 手势恢复、`169d3a1c` 渲染态内容搜索 |
| 2026-09-10 | worktrees 的 `DetailPane.tsx` 最后一次改动是 `16d56021`（host 0.1.2 适配）——**预览冻结在拆分那天** |

local-files 自己的注释就写着 `preparing for a future merge`（`packages/local-files/src/client/DetailPane.tsx:16-17`）。

### 三条能力错位（2026-09-23 用户反馈，逐条核实）

| 能力 | 文件列表（local-files） | 工作树（worktrees） |
|---|---|---|
| per-file 打开目录 / 在 IDE 中打开 | 有：复制路径 + 打开目录 + 在 IDE 中打开，三件套在预览头（`src/client/DetailPane.tsx:401-431`），打开的是 `dirnameOf(path)`（`WorkspaceView.tsx:264-271`）；IDE 候选表在 `open-in-app.ts:42-46,68-75` | **无**：预览头（`DetailPane.tsx:139-199`）只有 返回/标题/差异-内容切换/预览-源码段/**复制内容**；tab 头的「打开目录」打开的是 worktree 根（`WorktreesTab.tsx:442-446`），整个包没有 IDE 候选表 |
| 源码 ⇄ 渲染 切换 | **无** md/json/csv 的源码切换，只有 HTML 三档「源码/渲染/运行脚本」+ 全屏（`DetailPane.tsx:455-499`） | **有** md/json/csv/html 的「预览/源码」段控件（`DetailPane.tsx:70,172-189`） |
| HTML 渲染档位 | Tier0 + **Tier1**（`sandbox="allow-scripts"`，永不同开 `allow-same-origin`）+ 一次性确认 + 能力桥 + 静态提示条 + 大文档 content-visibility + 20s 看门狗 + 全屏（`html-src-doc.ts` 111 行 + `html-bridge.ts` 101 行 + host 侧 `isScriptedHtml`） | **只有 Tier0 静态**（`html-src-doc.ts` 38 行）：无脚本档、无提示条、无关卡、无 watchdog、无全屏；host 的 `ReadFileResult` 连 `htmlScripted` 字段都没有 |
| Markdown 排版 | 不覆盖任何元素级样式，吃官方 `.markdown` 节奏；外层 `.previewScroll` 24px 页边距 + 格式 banner + 正文 `12px 16px`（`DetailPane.module.css:399-447`） | **用自写元素级 override 打官方 sheet**（`DetailPane.module.css:243-279`：`p{margin:0 0 12px}`、`ul/ol{margin:0 0 12px;padding-left:22px}`、`li{margin:3px 0}`、`h1{margin-top:0}`、`blockquote{margin:12px 0;border-left:3px}`），官方是 `p 16px 0`、`ul/ol 16px 0 + 18px`、`li:not(:first-child) 6px`、`h1-h3 32px 0 16px`；`.body` 无 padding（`:193-198`） |
| 结构化（JSON/CSV）排版 | 套进 `.structuredBody` 的 `--dsw-font-markdown-*` token（14px 体系） | 裸返回（`DetailPane.tsx:108,120-121`），CSV 的 GFM 表按 **16px 聊天字号**渲染 |
| 内容搜索 | 有：渲染态保留 + CSS Custom Highlight 命中 + 原始行降级（`rendered-search.ts` 242 行） | **无** |
| 其它 | 滚动位置记忆、脚本确认框、慢渲染提示、二态 empty/binary/too-large 占位 | 无 |

**截图里的 HTML bug（可复现）**：用户截图 3 的 `proposals/prototypes/agora-shared-ground-storyboard.html` 是 **untracked**（面板自述「未跟踪的新文件 — 无 diff，仅内容」，`git status` 确认 `??`），命中 worktrees 的 untracked 分支，三个缺陷叠加：① 它第 699 行的 `<script>`（页内 tab 切换）在 `sandbox=""` 下永不执行，点击无反应且无任何提示；② untracked 分支（`DetailPane.tsx:98-111`）**无视 `showPreview`**，「源码」按钮点了没反应；③ `.untrackedView` 无高度（`DetailPane.module.css:302-307`）而 `.htmlRender{height:100%}`，iframe 百分比高度无基准，退化为 replaced element 默认高度。

### 重复度实测

| 模块 | worktrees | local-files | ui-file-preview | 关系 |
|---|---|---|---|---|
| `DetailPane.tsx` | 208 | 527 | 510（`FilePreviewPane`） | 三份分叉；local-files 是 ui-file-preview 同形 + worktrees 分叉的并集 |
| `structured.tsx` | 133 | 133 | 159 | worktrees/local-files 除命名空间与 `label` 外逐字节相同 |
| `html-src-doc.ts` | 38 | 111 | 109 | 全仓 **4 份** srcdoc 实现（加 `inline-html-render/srcdoc.ts` 93 行） |
| `html-bridge.ts` | — | 101 | 99 | 全仓 **3 份** 桥（`inline-html-render/bridge.ts` 已作为 canvas 的共享 helper 存在） |
| `rendered-search.ts` | — | 242 | 242 | 两份仅 `@module` 注释不同 |
| `language.ts` / `FileTree.tsx` / `local-root.ts` / `open-in-app.ts` | 72/425/62/139 | 77/431/62/149 | 各自 | 同源小漂移 |
| `LocalFilesDrawer.tsx` | 277 | `WorkspaceView.tsx` 277 | — | 同骨架分叉 |

### 已经付的利息

1. **worktrees 的 `LocalFilesDrawer` 在产品里已不可达**：唯一入口 `WorktreesController.openLocalFiles` 全仓无调用者（badge 的文件夹胶囊在 `ea531c4b` 已删），277 行分叉带着两个真 bug：选中行拿绝对路径比 root-relative 比不中（`LocalFilesDrawer.tsx:227,230` vs `FileTree.tsx:335`）；`css.treeEmpty` 在 CSS 里根本不存在（只有 `.worktreeEmpty`），加载/错误文字无样式。
2. **local-files 的 `DetailPane` 有 18 个无人引用的 CSS 类**（从 ui-file-preview 抄按钮的残留 `.seg/.toggle/.titleBar` 等）——两份「镜像」已经在漂移。
3. **测试没跟着代码走**：ui-file-preview 有 `tests/html-src-doc.client.spec.ts` / `tests/html-bridge.client.spec.ts`，local-files 复制了同一份代码却**一份测试都没带**。
4. **能力不对等产生静默失败**：worktrees 里 >2MiB 的文件读是抛错（显示错误占位），而它自己的 `detail.tooLarge` 文案无人引用。

## 能力清单（新包验收清单）

新包：**`@khorsheed/dsh-client-ui-content-preview`**（目录 `packages/ui-content-preview`），client-only、源码面共享、两个插件以 tsdown 打包（零运行时耦合）。下列每条都是验收项，按「统一后两边都要过」判定。

### A. 内容契约（内核持有，插件适配）

| # | 能力 | 判定 |
|---|---|---|
| A1 | 内核定义自己的 kind 联合 `PreviewRead`：`text{content,truncated?,htmlScripted?}` / `image{url,size?}` / `binary` / `missing` / `too-large` / `error{message?}`，并带 `path` | 内核不 import 任何插件的 Remote 类型；两个插件各自写 adapter 把 `LocalFilesRead` / `ReadFileResult+FileDiffResult+LocalImageResult` 映射进来 |
| A2 | 内核零 `@khorsheed` 依赖边（不 import 任何插件） | `pnpm check:plugins` 通过；两个插件 → 内核的边在 `ALLOWED_EDGES` 里显式登记 |
| A3 | 内核不注册 slot / locale / service（它不是插件） | 内核无 `cordis.patch.yml`、无 `dsh.bundle`；`dsh.composition.component` 说明它如何被组合 |

### B. 内容视图分发

| # | 能力 | 判定 |
|---|---|---|
| B1 | HTML：三档「源码 / 渲染 / 运行脚本」+ 全屏 | 两边都有；Tier0 为默认 |
| B2 | 非 HTML 文本：**通用**「渲染 ⇄ 源码」切换（md / JSON / CSV） | 两边都有（今天 local-files 缺） |
| B3 | 渲染默认档：md 与 JSON/CSV 默认渲染；其余默认源码 | 与 worktrees 现行为一致，local-files 补上切换后不回归 |
| B4 | 图片：data URL + 尺寸提示；binary / too-large / missing / error 各有设计占位 | 不留空 `CodeBlock`（worktrees 的 drawer 现状即反例） |
| B5 | 截断提示（`truncated`）在正文之上，且**不计入内容搜索命中** | 带 `data-dsh-search-skip` 的节点不进命中集 |

### C. Markdown / 结构化排版（硬口径）

| # | 能力 | 判定 |
|---|---|---|
| C1 | **只允许覆盖官方 `--dsw-font-markdown-*` token；禁止覆盖 `.markdown` 元素级 margin/padding** | 内核 CSS 内不出现 `.markdown p`/`ul`/`li`/`blockquote` 等选择器（worktrees 现状违反，本提案删除） |
| C2 | 统一外层：滚动容器 24px 页边距 + 格式 banner（标出 markdown/json/csv…）+ 正文 `padding: 12px 16px` | 两边渲染同一文件在相同宽度下**目视一致**；banner 文案来自内核字典 |
| C3 | 每个渲染形态（md / JSON / CSV / HTML）都在同一 token 作用域内 | 禁止裸返回渲染体（worktrees 的 CSV 现状违反） |
| C4 | 首/末子元素边距归零、标题 32/16、段落 16、列表 16 + 缩进 18、引用 16 + 2px 边框 | 与官方 `MarkdownText.module.css` 一致；截图对照为验收证据 |

### D. HTML 沙箱（沿用 `file-view-html-rendering` 的既有裁决）

| # | 能力 | 判定 |
|---|---|---|
| D1 | Tier0 = `sandbox=""` + 内嵌 meta CSP；Tier1 = `allow-scripts`，**任何档位都不开 `allow-same-origin`** | 两边一致 |
| D2 | 含脚本文件的 Tier0 必须**不静默**：注入提示条，说明脚本未运行及出口 | 两边一致（worktrees 现状违反） |
| D3 | Tier1 需一次性确认（每文件）；提供「停止脚本」；桥只暴露 `openLink`(https) / `copy`(≤1MB) / `download`(data:) | 桥校验 = `message.source` + fn 白名单 + 参数形状；非法调用回 `{ok:false}` 不抛 |
| D4 | 大文档：注入 `content-visibility` 延迟渲染；>256KiB 或 Tier1 装 20s 看门狗给提示 | 两边一致 |
| D5 | `htmlScripted` 由 **host 探测**（`<script` / 事件属性）随 read 一起下发 | 两个 host 都有该字段（worktrees 现状缺） |
| D6 | **不承诺相对资源解析**（`file-view-html-rendering` §风险已裁决），提示用户用内联/data: | 文档写明；不得因官方 HTML renderer 能打包相对依赖而在此处静默改变语义 |

### E. 内容搜索

| # | 能力 | 判定 |
|---|---|---|
| E1 | 保留渲染态、以 CSS Custom Highlight 画命中；不支持 Highlight API 时降级到原始行视图（不得白屏） | 单测覆盖「渲染态保留 / 源语法只命中源码 → 降级 / 无命中仍渲染」 |
| E2 | 仅文本 kind 显示搜索行 | 非文本 kind 不出现搜索框 |
| E3 | banner / notice / chrome 不计入命中 | `data-dsh-search-skip` |
| E4 | HTML 沙箱内文本不参与搜索（opaque origin 读不到），走原始行降级 | 与现状一致 |

### F. 面板 chrome（per-file）

| # | 能力 | 判定 |
|---|---|---|
| F1 | 复制路径 / 打开目录 / 在 IDE 中打开，三手势按 open-in-app 探测结果**逐项**显隐 | 两边都有（worktrees 现状缺后两个） |
| F2 | 「打开目录」作用于 `dirnameOf(path)`（host 路由只收目录）；无可用 app 时不渲染空按钮 | 两边一致 |
| F3 | IDE / 文件管理器候选表由内核提供（`pickFileManager` / `pickIde`），一次/页探测，失败即静默隐藏 | 探测可注入（便于单测） |
| F4 | 滚动位置按 (session, path) 记忆 | 两边一致 |

### G. 边界（**不**归内核）

| # | 不归内核 | 归属 |
|---|---|---|
| G1 | 文件树 / 列表结构 / 目录懒加载 / 状态标记 | 各插件 |
| G2 | 数据面（Remote、store、root 选择、workspace 切换） | 各插件 |
| G3 | **diff 与提交对比** | worktrees 以 render prop 传入（用户裁定） |
| G4 | tab 注册、可见性自隐、badge | 各插件 |

### H. 非功能

| # | 能力 | 判定 |
|---|---|---|
| H1 | 内核以**源码面**被两个插件打包（`./src/*` export），运行时不需要单独安装内核 | 两个插件 `lib/client.js` 自包含；卸载内核不影响两个插件的既构建物 |
| H2 | locale：内核导出自己的键值字典（zh/en），调用方以展开方式并进自己的命名空间 | 不产生跨插件的 locale 命名空间冲突 |
| H3 | 测试：内核自带单测（srcdoc 包装 / CSP 注入 / 桥校验 / 搜索降级 / 排版口径静态断言） | `pnpm --filter <kernel> test` 绿 |
| H4 | 门禁：`check:plugins` / `check:hygiene` / 受影响包 build+test 全绿 | 合并前 `pnpm gate` |
| H5 | 退休路径：官方一旦导出可复用文档渲染器（导出组件或开放可渲染 slot），内核退化为 shim，再删除并 `closed（官方吸收）` | 见下「退休路径」 |

## 方案

### 包形态与门禁改动

- 新包 `packages/ui-content-preview`，`name: "@khorsheed/dsh-client-ui-content-preview"`，**非 self-mount**：`dsh.composition.component` 需要一个描述「源码面共享库」的取值。
- `scripts/check-plugin-independence.ts` 是 mainline 维护的共享层，本次需要两处**登记式**改动（该文件自己的注释即写明「任何新的跨包需求都要照同样模式并显式加进来」）：
  1. `COMPOSITION_COMPONENTS` 增一个源码面共享库取值，`NO_OWN_PATCH` 增 `ui-content-preview`；
  2. `ALLOWED_EDGES` 增 `'local-files': ['@khorsheed/dsh-client-ui-content-preview']` 与 `'worktrees': ['@khorsheed/dsh-client-ui-content-preview']`。
- 这条边是**编译期**边：tsdown 把内核源码打进两个插件的 client bundle，零运行时耦合——与既有 `canvas → inline-html-render` 的 sanction 形状完全相同。

### 内核 vs 调用方（组件形状）

```
<ContentPane
  read={PreviewRead}                    // 插件适配后的 kind 联合
  sessionId?={string}
  chrome={{ copyPath?, openFolder?, openIDE?, canOpenHost? }}
  diffView?={ReactNode | (view) => ReactNode}   // worktrees 传入；local-files 不传
  labels={PreviewLabels}                 // 由调用方注册的字典构造
  t={...}
/>
```

- `detailView: 'diff' | 'content'` 的**状态归调用方**（worktrees 已如此），内核只在给了 `diffView` 时渲染切换控件。
- 内核不持有数据获取：`read` 由调用方按需拉取（现状两边都是这个形状）。

### 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 本能力清单定稿（提案正文 + README 总表） | 本批次 |
| M1 | 内核包落地：契约 + 分发 + HTML 两档（含桥）+ 排版口径 + 搜索 + chrome；自带单测 | 待开工 |
| M2 | local-files 接入：删私有实现，补「渲染 ⇄ 源码」切换；回归其 7 份测试 | 待开工 |
| M3 | worktrees 接入：删私有 `DetailPane`/`HtmlPreview`/`html-src-doc`/`structured`/`rendered-search` 副本；补 host 侧 `htmlScripted`；补 per-file 三个手势；删除不可达的 `LocalFilesDrawer` 及其两个 bug；修复 untracked 分支无视切换与 iframe 高度 | 待开工 |
| M4（可延后） | ui-file-preview 的 `FilePreviewPane` 并入内核（第三份拷贝），并把其 IDE 分体按钮能力**反向**并入内核（保持并集口径） | 待定 |

### 退休路径

本包是**过渡层**，不是终局。官方 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 已经具备：`ctx.documentPreviews` 注册表 + keyed `sidebar.right.tab.document` slot + 内建 markdown/code/html/image/pdf 渲染器，且官方 HTML renderer 能经 workspace-files Remote 把相对的 `<script>`/`<link>` 打包进隔离文档（`lib/types/client/html/pack.d.ts`、`read-relative.d.ts`）——这是任何手写 srcdoc 都做不到的（`base-uri 'none'` + srcdoc 下相对资源必然 404；`file-view-html-rendering` 已把「不承诺相对资源」作为裁决留档）。

今天不能直接用它的原因有两条，都是**契约问题而非能力问题**：

1. 官方 renderer 不导出可复用组件（`lib/client.js` 只导出 `apply`），只有 slot 注册；
2. `sidebar.right.tab.document` 是「声明即独占」（ui-slots `index.d.ts:130`：*Declaring is claiming — the registering entry becomes the only entry allowed to render these keys*），插件自有 pane 装不进官方 renderer，只能跳转到官方文档 tab（会失去「树 + 预览」同屏）。

所以退休触发条件写死为：**官方导出可复用文档渲染器，或开放第三方可渲染的同构 slot**。届时内核退化为 adapter（or 直接删除），本提案转 `closed（官方吸收）`，并把相对资源解析能力一并交还官方 renderer。

## 验收标准（done 判定）

1. 两边**同一能力清单逐条通过**（本文档 A–H 即验收清单），且以 `dsh plugin add/remove` 可插拔交付、零官方改动。
2. 用户 2026-09-23 报的三条错位全部消除：工作树有 per-file 打开目录/IDE；文件列表有 md/json/csv 源码切换；两边 HTML 与 md 排版一致（截图对照）。
3. 截图里的 storyboard（untracked HTML）在工作树里：源码切换可用、页内 tab 在 Tier1 下可点、Tier0 有明确提示、iframe 高度正常。
4. 重复实现清零：全仓 srcdoc 由 4 份降为 2 份（内核 1 + `inline-html-render` 1），桥由 3 份降为 2 份，`DetailPane` 由 3 份降为 2 份（内核 1 + ui-file-preview 1，M4 后可再降）。
5. 内核自带单测 + 两个插件既有测试全绿；`pnpm gate` 绿。
6. 落 Agent Note 记录内核边界与放弃的东西。

## 风险 / 放弃的东西

- **动到共享层门禁**：`COMPOSITION_COMPONENTS` / `NO_OWN_PATCH` / `ALLOWED_EDGES` 属 mainline 维护面（`docs/development.md`）。这次是**登记式**最小改动（各 +1 行），但需向 mainline 说明；不新增任何检查逻辑。
- **第三个拷贝的风险**：M4 未完成期间，ui-file-preview 仍是独立实现——内核对它是可选项而非强绑，避免一次改动三个包把风险叠满。
- **能力并集的反向吸收**：ui-file-preview 的 IDE 分体按钮（带 app 菜单与 app 名）比 local-files 的单一 IDE 按钮更强；内核取强的一侧会改变 local-files 的交互（多一个菜单），需要在 M2 明确取舍（默认：保留分体按钮，菜单项为空时退化为单按钮）。
- **Tier1 语义不变**：不因内核化而放宽 CSP / 打开 `allow-same-origin`；不改 Tier0 默认。
- **相对资源仍不解析**（沿用既有裁决）：这是与官方 renderer 的真实能力差，明写在文档里，不静默补齐。
- 放弃：让内核持有 slot 注册（会把它变成插件，破坏「独立可用」）；让内核吃 diff（用户已裁定 render prop 传入）。

## 实现记录

- 2026-09-23：提案建立（本文件），能力清单 A–H 定稿；查重结论见头部。关联提案：`active/2026-08-21-file-view-html-rendering.md`（Tier0/Tier1 渲染能力，本内核承接其产物）、`closed/2026-08-26-local-files-browser.md`（本提案是其 §形态 里预告的「共享预览层抽提」）、`active/2026-08-23-worktree-governance.md`（worktrees git 面）。
