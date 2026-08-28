# Agent Note：capability-catalog 的 UI 是预览网格 + 居中详情弹窗，add-skill 用零依赖 zip 读取器

Status: implemented

[English](2026-08-28-capability-catalog-ui-and-zip.md) | 中文

本笔记与 [`capability-catalog` 提案](../../../../proposals/active/2026-08-26-capability-catalog.md) 配套，记录 v1（包 `@khorsheed/dsh-capability-catalog`）交付的两个决策。

## 问题

catalog 提案 v1 的 GUI 原本描述成官方风格折叠卡 + 独立 MarkdownText 阅读器（一个单独的"查看完整内容"面）。用户要的是三列预览网格 + 居中详情弹窗，且源码做成**文件浏览器**——左文件树 + 右内容窗格，类似 worktrees 的仓库文件视图——否则独立的「包文件」区和裸「查看源码」块会重复。另外，add-skill 的 zip 路径原本用第三方 zip 库，但 typert 生成器的 scratch overlay 只解析 `@deepseek-ai/*` 源码面包与 harness 自身 node_modules（第三方 host 依赖解析不到），host 构建因此挂。而且目录用 host-global scope 快照 skill registry，只看到 runtime skills——模型经 agent-preset scope 能看到用户/官方技能而设置面板看不到；运行时插件 skill 的 bundle 文件（scripts/assets）除非插件暴露，否则不可见。

## 决策

**1. GUI 是三列预览网格 + 居中详情弹窗，而非折叠卡展开或独立阅读器。** 提案原本描述官方风格的折叠卡（点击就地展开）；用户改为：三列预览卡网格（名字 + 一行描述 + 来源/provider 徽标），点击卡片打开居中弹窗。弹窗按需通过 `ctx.skills.get()` 加载单个 skill，展示完整描述、来源/provider/调用面 meta，以及当 metadata 声明凭据时每个凭据的配置块（`credentials.set`，值不上 wire；`describeRecord` 只读显示已配置状态）。**源码是分栏浏览器**（用户要源码做成像 worktree 仓库文件那样的文件树）：目录包 skill 的「查看源码」区 = 左文件树 + 右内容窗格——树列出该包 `resourceBase.kind === 'directory'` walk 出的 SKILL.md + references/scripts/assets；点文件用 `readSkillFile` Remote 按需加载其文本（SKILL.md 复用已加载的详情正文）；单文件 skill 回退为裸 `content` 块。不再有独立的「包文件」区——**树本身就是源码**。独立 tab 注册为 `settings.section`（id `capabilities`，order 20，在 Plugins=15 之后），沿用 local-agent 注册姿势。

**2. add-skill 解压是零依赖 zip 读取器（`node:zlib`），而非第三方 zip 库。** 原计划 host 半用 adm-zip，但 host 面文件被 typert 生成器针对一个 scratch overlay 分析，而 overlay 只解析 `@deepseek-ai/*` 源码面包与 harness 自身 node_modules——第三方 zip 库不在其中，gen-typert 以 `TS2307: Cannot find module 'adm-zip'` 失败。（`zod`/`@deepseek-ai/schemastery` 能过只是因为它们恰好是 harness 依赖。）既然不允许改 host 且 overlay 按进程生成，修法是 `src/zip.ts`：一个最小读取器，用 `zlib.inflateRawSync` 处理 store(0) 与 raw-deflate(8)，跳过目录并拒绝路径穿越。这使发布包免于 zip 运行时依赖，也让 host 面仅含 node 内置 + `@deepseek-ai/*`（overlay 原生解析）。add-skill 弹窗提供"上传压缩包"与"粘贴 SKILL.md"两个 tab；都装入 `$DSH_HOME/skills/<name>/`（user）或 `.agents/skills/<name>/`（project），由既有 skill-filesystem watcher 发现——无需新注册机制。GitHub 克隆 v1 暂缓（`channel === 'github'` 返回"not wired in v1"）。

## 备选方案

- **host 半用 adm-zip / jszip。** 否决：gen-typert overlay 解析不到第三方 host 依赖，生成即挂。客户端解压（jszip）虽可绕过，但增加客户端 bundle 依赖与更大请求，且违背用户选定的 host 侧 UX。
- **沿用提案的折叠卡 + 独立 MarkdownText 阅读器。** 被用户的网格 + 弹窗选择取代；弹窗复用同样的详情加载，未损失任何表层。

## 影响

- 无新增运行时依赖；host 面仅含 node 内置 + `@deepseek-ai/*`，故 `pnpm check:plugins` 与发布构建均全绿。
- skill 卡按设计只作预览；详情需点击（符合提案"列表绝不全量取正文"的渐进加载规则）。
- **skill 的 scope 是 agent preset 的 standing key，而非 host-global。** 目录用 `agentPresets.standingKeyFor(defaultId)` 快照——这是官方给 host 无 agent 读取者的 seam——使 host-global 的设置面板看到与模型相同的官方/插件/用户技能（web bundle 把 skill-filesystem 挂在 preset 的 standing scope 而非 global）。`detail`/`get` 走同一 scope key，所以用户技能的完整正文、metadata 与声明的凭据都能加载。当 presets 服务缺失时退化为仅 global 层（最小 profile 无 preset ⇒ 仅 runtime，此处正确）。
- **bundle 可见性是插件的选择。** skill 的源码分栏只在 registry 暴露 `resourceBase.kind === 'directory'` 时渲染。文件/提供者发现的 skill 总是有；运行时插件 skill 只在插件注册时带 `resourceBase`（或走 `registerProvider`）才有。内容合成型 skill 渲染成**虚拟单节点 `SKILL.md`**（统一源码浏览器），而非裸正文块——不伪造磁盘路径。这条契约写成包 README 里的「插件 skill 注册协议」（并作为上游候选，建议 dsh-skill 显式写明）。
- **新增 skill 是三来源 + env 解析。** 弹窗有 文件上传（拖拽 `SKILL.md`/`.zip`/skill 文件夹，零依赖 `node:zlib` 解压）、命令安装（`owner/repo`、git URL 或 `npx skills add <repo> -g` 表单——host 提取 repo `git clone` 进受管根并抬层嵌套 `SKILL.md`；真 `npx skills add` 会装到 dsh 扫不到的外部目录）、从本机目录（列出容器内 `<name>/SKILL.md` 勾选安装）。凭据从 `metadata.credentials` 与正文 `$ENV`/`process.env.X`/`env['X']`/`{{env:X}}` 引用解析，token/env 泛化呈现（不假设是 apikey）。
