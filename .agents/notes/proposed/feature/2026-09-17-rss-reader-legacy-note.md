# Agent Note: dsh-rss-reader plugin design proposal

Status: proposed

## Problem

用户需要在侧边栏订阅 RSS 源、每日查看更新内容，并在遇到问题时引用条目内容（类似文件引用机制）到当前/侧边对话。插件应遵循 dsh-plugins 仓库规范：独立可装卸、不修改宿主、复用宿主能力（slots、sideChat、fs、remote）、与 quote/sidechat 保持独立但可配合的关系。

## Proposal

创建新插件 `@khorsheed/dsh-rss-reader`（参考 `@khorsheed/dsh-quote`、`@khorsheed/dsh-sidechat` 命名）：

1. **结构**：宿主半（`src/index.ts`、`service.ts`、`store.ts`、`remote.ts`、`types.ts`、`invariant.ts`）+ 客户端半（`src/client/`、`package.json` `dsh.client` 块、`cordis.patch.yml`）。
2. **独立性**：完全独立（各自有 `cordis.patch.yml`）；不编译期依赖 `quote` 或 `sidechat`，而是通过 `ctx.get('sideChat')` 和 `dsh.references` 声明数据关系（参考 `quote` 的 `dsh.references` 模式）。
3. **挂载**：通过 `ctx.slots.inject('sidebar.right.pane.tab', ...)` 注册到右栏（参考 `ui-file-preview` 的 `sidebar.right.pane.tab` 注册），优先 slots 注册，缺失时优雅降级（不显示面板）。
4. **数据源**：手动配置（插件状态存储，参考 `sidechat` 的 `SideChatStore` 和 `ctx.fs`）+ 外部文件/环境变量（通过 `ctx.fs.readText` 读取外部配置）+ 每日自动刷新（插件自有定时器，用户可配置刷新时间，默认早上 10 点，也支持手动刷新）。
5. **RSS 格式**：支持标准 RSS 2.0 和 Atom 0.3，解析完整元数据（标题、链接、作者、发布日期、分类标签、完整摘要）；不解析内容全文。
6. **与 quote 交互（双向）**：
   - RSS 条目可被选中后生成引用块（包含条目标题、链接、摘要），参考 `quote` 的 `quoteRemote` 机制；
   - 引用到侧边对话时，通过 `ctx.sideChat?.openWith()` 传入条目内容（类似 `quote` 的 `addRef`），在侧边对话打开新上下文并包含该条目内容；
   - 无 `sideChat` 服务时，对应动作隐藏（不报错）。
7. **与宿主关系**：不修改宿主（不编辑 `deepseek-harness` 代码），复用宿主能力（`slots`、`sideChat`、`fs`、`remote`、`agent`、`systemPrompt`）；所有可选能力在运行时探测并降级（参考 `quote` 和 `sidechat` 的 `degrade, don't explode` 原则）。

## Alternatives considered

- 为什么不用编译期依赖 `sidechat`：根据仓库规范（AGENTS.md），每个插件必须独立安装、运行、卸载；编译期依赖会形成双向依赖循环（`dsh-rss-reader` 依赖 `sidechat`，而 `sidechat` 不依赖 `rss-reader`），且 `pnpm check:plugins` 会拒绝非授权的交叉依赖。运行时探测（`ctx.get('sideChat')`）是仓库认可的模式（参考 `quote` 的 `SideChatMirror` 声明在 `dsh.references` 而非依赖字段中）。
- 为什么优先 slots 注册而非自己渲染面板：参考 `ui-file-preview` 当前做法（通过 `sidebar.right.pane.tab` 注册），这样与宿主的侧边栏管理机制一致，更容易被用户发现和管理；如果宿主没有提供合适的 slot，插件可以优雅降级（不显示面板，不影响核心功能）。
- 为什么插件自有定时器而非依赖宿主定时任务：宿主可能没有提供定时任务服务（如 `cron` 或 `schedule`）；插件自有定时器（如 `setInterval` 或基于 `Date` 的简单检查）完全自包含，不增加对宿主的依赖；同时支持用户配置刷新时间（默认早上 10 点）和手动刷新按钮，满足灵活性需求。

## Acceptance criteria

- 新插件目录 `packages/dsh-rss-reader/` 完整（包含 `package.json`、`cordis.patch.yml`、`src/invariant.ts`、`src/index.ts`、`src/service.ts`、`src/store.ts`、`src/types.ts`、`src/remote.ts`、`src/client/`、`tsconfig.json`、`readme.md`）。
- `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，`dsh.client` 声明 `platform: 'web'`、`inject` 列表、`dsh.compat`（`minHost` 参考 `sidechat` 的 `0.1.5-rc.1`）和 `dsh.references`（包含 `@khorsheed/dsh-sidechat`、`@khorsheed/dsh-quote`）。
- `cordis.patch.yml` 声明插件的独立加载行（参考 `quote` 的格式），不重复插入 `sidechat` 或 `quote` 的行。
- 宿主半实现 RSS 数据解析（支持 RSS 2.0 / Atom 0.3）、订阅源管理（添加/删除/编辑）、数据持久化（通过 `ctx.fs` 写入 `$DSH_HOME/state/dsh-rss-reader/`，参考 `sidechat` 的 `SideChatStore` 模式），并提供 `Remote` 服务（参考 `quote` 的 `remote.ts`）。
- 客户端半通过 `ctx.slots.inject('sidebar.right.pane.tab', ...)` 注册侧边栏面板，包含订阅源列表、今日更新内容、刷新按钮、引用动作（参考 `quote` 的引用机制）。
- 与 `quote` 的双向交互：点击条目生成引用块（包含标题+链接+摘要），可选择「引用到当前」或「引用到侧边对话」；无 `sideChat` 服务时动作隐藏（不报错）。
- 每日自动刷新功能：插件自有定时器（默认早上 10 点，用户可配置刷新时间），支持手动刷新按钮；刷新失败时优雅降级（记录日志，不中断核心功能）。
- 完整构建（`build` + `test`）通过，不修改宿主代码，不影响已有插件的构建和运行。

## Risks

- 宿主 `slots` 的 `sidebar.right.pane.tab` 可能在未来版本中发生变化（如重命名、移除）；插件应通过 `ctx.slots.inject` 注册，并在缺失时降级（不显示面板），参考 `quote` 的 `shell.overlay` 降级策略。
- `sideChat` 服务的 API（如 `ctx.sideChat.openWith` 的参数格式）可能在未来版本中变化；插件应在运行时探测（`ctx.get('sideChat')`）并根据返回的服务对象调用方法，避免直接依赖具体接口签名（参考 `quote` 的 `SideChatMirror` 声明方式）。
- RSS 数据解析可能遇到非标准格式或恶意内容；插件应实现安全解析（限制内容长度、过滤特殊字符），参考 `quote` 的 `foldRefsIntoText` 安全处理模式。
- 外部文件配置（如 `.rss-config.json`）可能包含敏感信息（如订阅源的私有 URL）；插件应在读取时验证路径（不读取任意路径），参考 `file-preview` 的 `resolve` 安全模式。
