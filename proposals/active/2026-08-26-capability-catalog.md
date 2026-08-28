# 能力目录（capability-catalog）

- **分类**: plugin
- **状态**: in-progress
- **最后更新**: 2026-08-28
- **查重结果**: 已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）——「技能/工具目录、注册渠道、capability inventory」命中均为无关项：[local-files-browser](../closed/2026-08-26-local-files-browser.md)（本地文件系统浏览，非能力目录）、[package-management](2026-08-21-package-management.md)（包分类/整合包形态，非运行时注册渠道）、worktree-governance（git 状态）、upstream-meta-pack-reconcile（依赖展开）。**无「枚举运行时 skill+tool 及其注册渠道」的同意图提案**。关联：无（新能力，独立交付）。
- **官方依赖**: 纯插件。全部机制基于现有能力：`ctx.skills.snapshot()`（`@deepseek-ai/dsh-skill`，skill 摘要自带 `source`/`provider`/`rank`/`invocation`）、`ctx.tools.schemas()`（`@deepseek-ai/dsh-tools`）、`tools/change` / `skills/change` 事件、typert Remote 数据面（message-tools / local-agent 同款）、`settings.section` 槽位（local-agent 同款注册姿势）、`dsh plugin add` 安装管线。**零 harness 改动**。
- **实现记录**: 已交付包 `@khorsheed/dsh-capability-catalog`（host/client 双半）。4/4.5 GUI 落地：**独立 `settings.section`（工具与技能）+ 三列预览网格 + 居中详情弹窗（完整 desc + source/provider + 统一源码浏览器（左文件树 + 右详情；内容合成型渲染虚拟单节点 SKILL.md）+ metadata + 凭据配置块（从 metadata.credentials 与正文 `$ENV`/`process.env.X`/`env['X']`/`{{env:X}}` 解析出的每个 env））+ 顶部「新增 skill」按钮**。5 新增 skill 落地为**一个弹窗三来源**：文件上传（拖拽 zip/SKILL.md 文件夹，零依赖 `node:zlib` 解压）/ 命令安装（`owner/repo`、git URL 或 `npx skills add <repo> -g` 表单 → host 提取 repo `git clone` 进受管根 + 嵌套 SKILL.md 抬层）/ 从本机目录（列出目录内 `SKILL.md` → 勾选 → 拷贝）。**关键约束**：host 面文件被 gen-typert 的 scratch overlay 分析，而 overlay 只解析 `@deepseek-ai/*` 源码面包与 harness node_modules 里已有的依赖——第三方 zip 库（ad‑zip）解析不到，故改为**纯 node:zlib 的零依赖 zip 读取器**（`src/zip.ts`）。**三类 skill（官方/插件/用户）全量展示**：目录用 `agentPresets.standingKeyFor(defaultId)` 作为快照与 `get()` 的 scope；`list_capabilities` 工具用调用方的 `exec.agent` scope。测试实例：`--profile cap-catalog-test --port 3090`，版本 0.1.30。

## 目标

在 dsh web 里提供一个**能力目录**：把运行实例中所有 **skill** 和 **tool** 及其**注册渠道**（官方内置 / 项目 / 用户 / 自定义 / 运行时插件 / MCP）完整列出来，GUI（设置页独立 section）+ 模型可调用查询工具双通道呈现，并实时跟随注册变化刷新。skill 支持**详情阅读器**（读 SKILL.md 正文 + frontmatter/metadata）与**凭据配置**（带 API key 的 skill 声明所需 credential、引导填值）；提供「新增 skill」入口（本地文件 / GitHub 克隆 / npm 插件多渠道分流），并可设定"是否进模型 catalog"。

服务三类人：**开发者/诊断者**（"我这个实例装了哪些技能和工具、从哪来的、为什么某工具不可用"）；**模型自己**（"有没有操作 X 的工具"——高频提问者）；**普通用户**（"我上传的 skill 生效没有、MCP 接入的 server 为什么 0 工具"）。

**明确不做**（见「风险/放弃」）：npm 分发 skill（方案 C，cordis 插件形态，作为**独立提案**推，不占本包代码）；skill 内容编辑/删除（编辑走文件系统）；MCP 配置管理（改 server 配置是 plugin/设置的地盘）；工具调用（本插件只读）。

## 现状（已对源码逐行核实）

### skill 侧：渠道元数据官方已给出，直接可取

- 所有 skill 汇入 `ctx.skills`（`packages/skill/skill/src/index.ts`）。两个注册入口：
  - `ctx.skills.register()` —— 运行时 skill（插件在 apply 期注册），`source='runtime'`，rank 250；
  - `ctx.skills.registerProvider()` —— 提供者注册。官方两个 provider：`skill-filesystem`（扫本地目录）、`skill-badge`（官方捆绑）。
- `SkillSummary` **自带渠道字段**：`source`（枚举 `project-dsh`/`project-agents`/`runtime`/`user-dsh`/`user-agents`/`custom`/`bundled` + 自定义字符串）、`provider`、`rank`、`invocation`（model/user 可调用性）、`resourceBase`。
- filesystem provider 的根（`packages/skill/skill-filesystem/src/index.ts:241-261`）：项目 `.dsh/skills`(100) + `.agents/skills`(200)、`customSkillDirs`(300)、`$DSH_HOME/skills`(400)、`~/.agents/skills`(500)、bundled `$DSH_BUNDLED_SKILL_DIR`(600)。
- **读取入口**：`ctx.skills.snapshot({ cwd, scope })` 返回全部赢家摘要（含完整性与排序），`skills/change` 事件做增量刷新。宿主侧插件直接调用即可。
- **两层数据（渐进式加载，关键）**：
  - **摘要层**（`snapshot()`）：`name`/`description`/`whenToUse?`/`invocation`(modelInvocable+userInvocable)/`source`/`provider`/`resourceBase?`/`rank`/`path?` —— **不含 body、不含 metadata**，列表展示用这一层。
  - **详情层**（`ctx.skills.get(name)`）：在摘要基础上补 `content`（SKILL.md 正文）+ `metadata?`（frontmatter 的 `metadata: {...}` 透传，`packages/skill/skill-filesystem/src/index.ts` 的 `optionalMetadata`）—— **点开某个 skill 才 `get()` 一次**，列表绝不批量取（burn token + 慢）。
- **调用面双通道（回应"并非所有 skill 都要默认进 catalog"）**：`invocation.modelInvocable` 决定是否进模型 `<available_skills>` catalog（模型可调 `skill` 工具），`invocation.userInvocable` 决定是否可用户 `/name` 手势。默认**两者都 true**（进模型 catalog）。控制方式：文件 skill 在 frontmatter 写 `disable-model-invocation: true`（→ modelInvocable=false）；runtime skill 在 `ctx.skills.register()` 时传 `invocation`。**本仓现有 skill（file-preview 的 `3d-artifact`、inline-html-render 的 `inline-html-card`、ankh-guard 的 `dsh-self-restart-guard`、`~/.agents/skills/subagent-orchestration`）都未设 disable——默认全进模型 catalog**（本会话 system-reminder 即列三者，实测）。
- **官方 `dsh-badge` 默认禁用**（重要修正）：官方 `skill-badge` 提供 `dsh-badge`（品牌徽章技能，`modelInvocable:true`），但其插件行在 base 层 **`disabled: true`**（`packages/bundle/base/cordis.patch.yml:243-245`）——**默认未注册、不在 catalog、不可触发**。用户要启用须在 profile 用户 patch 层 override `disabled: false`。这正是一个目录"启用/禁用开关"的典型用例。**真 `bundled`（rank 600）**来自 filesystem 扫 `$DSH_BUNDLED_SKILL_DIR`，本实例未设该变量，故当前无 bundled skill。

#### 来源判定矩阵（skill 渠道分类依据）

| `source` | 渠道 | 谁注册 | 与 `cwd` 关系 | rank | 本实例现存 |
|---|---|---|---|---|---|
| `runtime` | 插件 | `ctx.skills.register()` | **无关** | 250 | `3d-artifact`/`inline-html-card`/`dsh-self-restart-guard` |
| `bundled` | 官方(bundle) | filesystem 扫 `$DSH_BUNDLED_SKILL_DIR` | 无关 | 600 | 无（未设该变量） |
| `skill-badge` | 官方(provider) | `skill-badge` provider（base 默认 disabled） | 无关 | `BUNDLED_SKILL_RANK` | 无（默认禁用） |
| `project-dsh` | 项目 | filesystem 扫 `<cwd>/.dsh/skills` | **是** | 100 | 无 |
| `project-agents` | 项目 | filesystem 扫 `<cwd>/.agents/skills` | **是** | 200 | 无 |
| `custom` | 自定义 | filesystem `customSkillDirs` | 配置 | 300 | 无 |
| `user-dsh` | 用户 | filesystem 扫 `$DSH_HOME/skills` | 无关 | 400 | 无（目录空） |
| `user-agents` | 用户 | filesystem 扫 `~/.agents/skills` | 无关 | 500 | `subagent-orchestration`（当前 scope 未命中） |

> **判定要点**：①② 插件 skill 是 `runtime`，不看 cwd，provider=插件名；③ 官方 skill 可能是 `bundled`（filesystem）或 `skill-badge`（独立 provider）；④ 是否进模型 catalog 由 `invocation.modelInvocable` 决定，与 source 无关；⑤ 排序已由 `snapshot()` 按 name 完成，rank 只在**同名冲突**时参与裁决（且**scope 层 > rank**，nearest agent layer 覆盖全局层）；⑥ 目录展示集 = `snapshot()` 返回的**赢家**，rank/scope 冲突链仅作诊断辅助。
- **UI 现状**：官方 `skill.list` RPC 返回的 `SkillEntry` 只有 name/description/whenToUse/modelInvocable——注释明说 provider/source 词汇**留在 host 侧不上 wire**（`packages/host/apiproxy/src/api/skills.ts`）。所以 GUI 要显示渠道必须走插件自建 Remote。
- **凭据：skill 自身无原生凭据声明**。带 API key 的 skill 需约定：frontmatter `metadata` 里声明所需 credential key（本提案定义的约定），配置面调 `ctx.credentials`（`@deepseek-ai/dsh-credentials`：`<scope>/<id>` 双段 key、`set/unset/readRecord/describeRecord/listRecords`、值不上 wire）。dsh 无现成「skill→credential」映射，需此约定（见方案 5，属可 upstream 提议项）。

### tool 侧：注册表无来源字段（本提案第一缺口）

- 所有工具进 `ctx.tools`（`packages/core/tools/src/index.ts`），`ctx.tools.schemas(scope)` 列出全部可见工具 schema；`tools/change` 事件在注册/注销时触发（**无载荷** `(): void`）。
- **`ToolDefinition` 没有 source/provider 字段**——官方、插件、MCP 的工具在注册表内无法区分来源。现有唯一线索：
  - **MCP 工具命名强制前缀** `mcp__<serverName>__<rawName>`（`packages/mcp/mcp-client/src/index.ts:4`），且 **serverName 字符集含下划线**（`[A-Za-z0-9_-]{1,32}`）→ `mcp__a__b__c` 单靠前缀切分**分不出 serverName 是 `a` 还是 `a__b`**（本提案第三缺口的关键坑）。
  - 官方内置工具注册点：全仓 `ctx.tools.register(` 共 **53 处**（非测试），分布在 `packages/{fs,shell,web,todo,jobs,subagent,interaction,goal,plan,workflow,session-query,lsp,mcp,skill,tools}` 等，可脚本扫描生成白名单。
- **UI 现状**：无 `tool.list` RPC；客户端目前通过轨迹里的 tool/call 事件看"被调用过的工具"，看不到全量注册与渠道。

### GUI 侧：可复用事实

- `settings.section` 槽位（`packages/client/ui-settings/src/client/contract/slots.ts`）：kind=list、scope=root，注册姿势已在本仓 local-agent 落过（`packages/local-agent/src/client/index.ts:74-98`：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name, id, order, label, locale, inject }, Component))`）。
- typert Remote 双半模式：message-tools（`messageTools` service）与 local-agent（`localAgentGateway`）同款，host 半 `TypertRemoteService` + `@Remote()` 装饰器，client 半 `ctx.remote.$mount()`。
- **无任何官方的 npm-skill 安装机制**：`skill-filesystem` 只扫本地目录；「npm 装 skill」必须自定义（见方案 C 与独立提案）。

## 方案

**形态**：新包 `@khorsheed/dsh-capability-catalog`（host/client 双半）。零官方改动。

### 1) host 半采集器（`src/index.ts`）

- **skills 快照**：apply 时 + 每次 `skills/change` 后调 `ctx.skills.snapshot({ cwd, scope })`，保留 `source/provider/rank/invocation/resourceBase/path` 全字段。
- **tools 归因**（三层 + 置信度）：
  1. `mcp__` 前缀 → 渠道 `mcp`（serverName 解析见下）；
  2. **脚本生成的官方白名单**（见第 3 节）→ 渠道 `builtin`；
  3. 兜底 → 渠道 `plugin`。
  - **时间差分补强**：apply 时取 `ctx.tools.schemas()` 基线，之后每次 `tools/change` 做 diff；运行期**新出现**且不在白名单 → 高置信度 `plugin`；基线里有但未识别 → `builtin?`（低置信度，避免官方新工具漏标被误判成插件）。渠道字段带 `confidence: 'exact' | 'inferred'`。
- **MCP 交叉验证**（解析 serverName 歧义 + 诊断空 server）：读取 profile 的 `cordis.patch.yml`（路径经 `$DSH_HOME/profiles/<p>/`，实现时用 app-boot 的 profile 解析或直接读文件降级），提取所有 `mcp-client` 实例的 `serverName` 清单；据此把 `mcp__a__b__tool` 按**最长匹配**归属 server；同时列出「配置了但 0 个工具」的 server（连接失败/无工具，注册表永远看不到的诊断信息）。
- **数据模型**（wire）：`{ skills: SkillRow[], tools: ToolRow[], mcpServers: McpServerRow[], channels: ChannelSummary[] }`，每行带渠道/置信度/（skill）provider+source+rank+path /（tool）schema 摘要。
- **附赠模型查询工具**：`ctx.tools.register(defineTool({ name: 'list_capabilities', ... }))`，参数 `{ channel?, kind? }`，返回上述模型的结构化 JSON 子集（模型可调，与 GUI 同一数据源）。**工具本身也进目录**（自指无碍，归因兜底为 plugin）。

### 2) Remote 数据通道（typert 双半）

- host 半：`CapabilityCatalogService extends TypertRemoteService`，`@Remote('list')` 返回目录快照（含请求方 scope 的工具视图）。
- client 半：`ctx.remote.$mount(...)` 接线；GUI 每次打开 section / `skills/change` / `tools/change` 事件触发刷新（client 侧经 Remote 拉取；事件订阅可走官方 client 事件面或轮询降级）。

### 3) 官方工具白名单生成脚本（`scripts/`）

- 新脚本扫 `$DSH_HARNESS/packages/**` 的 `ctx.tools.register(` 调用点，提取 `name:` 字面量，生成 `src/official-tools.json` 随包发布。
- 锚定 `dsh.compat.minHost`：宿主升级后重跑脚本即可，README 写明白名单与宿主版本的对应关系（漂移从"人工漏标"变成"重跑一次脚本"）。

### 4) GUI：`settings.section` 独立页面（`src/client/`）— 三列预览网格 + 居中详情弹窗（用户已拍板）

- 注册 `settings.section`（id=`capabilities`，order=20，在 Plugins=15 之后），复用 local-agent 的注册姿势与 `settings.section` 槽位类型。**风格与官方「插件配置」页完全一致**（官方暗色 token）。
- **布局**：顶部 heading + intro + 右上「新增 skill」按钮；下方 Skills / Tools 双 tab（带计数）。
- **技能 tab = 三列预览网格**：每张预览卡 = skill 名（粗体）+ 一两行描述（line-clamp）+ source/provider 徽标（非 model-invocable 的加「仅用户」warn 徽标）。点击卡 → 打开**居中详情弹窗**。
- **详情弹窗**（点某卡才 `detail(name)` 一次，走 `ctx.skills.get()`）：
  - meta 行：`来源 / 提供者 / 模型可调用 / whenToUse`；
  - **凭据配置块**（仅当 `metadata.credentials` 声明了凭据时出现）：每项 `label + 密码输入 + 保存`（接 `ctx.credentials.set`，值不上 wire），`describeRecord` 只读显示已配置/未配置；
  - ▸ **查看源码**（SKILL.md 正文 `content`，`<pre>` 块）+ ▸ **metadata**（格式化 JSON）。
- **工具 tab = 折叠卡**（名 + 渠道归因），沿用到目录。
- 空态/加载态/错误态齐全；**官方依赖缺失时降级为空态不抛错**（AGENTS.md 铁律）。
- 一个「新增 skill」按钮置于顶部 heading 旁（不与列表并排）。**语言** zh + en（`ctx.locale.register`）。

### 4.5) skill 详情弹窗 + 凭据配置（`src/client/`，已落地）

- **形态**：点击预览卡 → **居中详情弹窗**（不自建独立路由页、不跨包依赖 `@khorsheed/dsh-worktrees`——那是 `shell.overlay` 并绑定"某会话某 root 目录"，语义偏；也避免社区包 cross-package edge）。弹窗内自建轻量展示。
- **弹窗内容**（进入时才 `ctx.skills.get(name)` 一次）：
  - 完整描述 + meta 条：渠道(source)、provider、模型可调用、whenToUse；
  - ▸ **查看源码**：`content`（SKILL.md 正文）以 `<pre>` 原样展示（首版不接 `MarkdownText` 渲染，保持零额外依赖）；
  - ▸ **metadata**：`metadataText`（格式化 JSON）；
  - **凭据区**：若 `metadata` 声明了所需 credential（见下方约定）→ 显示"本 skill 需要凭据：`<key>`" + 状态（已配置/未配置，经 `credentials.describeRecord` 只读、**值永不回传**）+ 填入动作（`credentials.set`）。
- **凭据约定（本提案定义，可 upstream 提议）**：skill frontmatter 写
  ```yaml
  metadata:
    credentials:
      - key: wechat-reading/api-key
        label: 微信读书 API Key
  ```
  目录读 `metadata.credentials[]`，据此展示凭据配置块；未声明则无凭据块。非 npm skill（纯文件 / GitHub 克隆）也能用——比"靠插件 settings 声明"更通用。

### 4.6) skill 凭据到达执行（评审后定为方案 B：catalog 自有窄工具；`ctx.shellEnv` 方案已否决）

- **问题**：skill 正文引用 `$<ENV>`（如 `$WEREED_API_KEY`），配置的凭据存在 dsh 官方凭据库（`$DSH_HOME/.credentials.yaml`），但**不会**被写进 `process.env`——launch-env 只是只读快照（process/project-env/user-env），无 credential→env 注入；模型/工具执行时环境里没有它（env 缺口）。
- **已否决：`ctx.shellEnv` 注入 DSH_\* 方案**（曾被初步实现，复核后否决并清除实现，只留本决策记录）：
  - **per-skill 隔离做不到（架构属性，非 bug）**：`shellEnv` 是按「agent scope」注入的，同一 preset scope 下所有 skill 的凭据会合成全集，对该作用域内**每一条模型 shell 命令**都可见（不区分当前执行哪个 skill）。这是把 secret 暴露给整个执行环境，不是「授权给某个 skill」。
  - **注入名强制 `DSH_*`**：官方 seam 只允许 `DSH_` 前缀变量（`shell-env/src/index.ts:119`），所以 skill 要的 `$WEREED_API_KEY` 不会自动出现，只能 `$DSH_WEREED_API_KEY`——不满足「原始名可用」。
  - **凭据 ref/key 空间错位**：目录写用 `credentials.set(ref, value)`（CredentialRef），`readRecord()`/`describeRecord()` 读的却是 CredentialKey（`<scope>/<id>`），harness 设计上两套刻意互斥——同一变量读不到。
  - **保留/已占用 key 崩整次注册**：`$HOME`→`DSH_HOME`（保留）、`DSH_SESSION_JSONL` 被 `session-persistence` 占用；任何 skill 出现这类声明会让整个 contributor 注册失败。
- **方案 B（评审选定）：catalog 自有窄工具**：
  - skill 明确要求模型「用 capability catalog 提供的 weread_\* 工具完成微信读书操作」，**不要自行读取/打印/配置 `WEREED_API_KEY`**。
  - 工具每次 operation **现场** `ctx.credentials.resolve(credentialRef('WEREED_API_KEY'))` 取到值（写用 ref、读也必须走 ref 空间的 `resolve()`；`credentialRef(key)` 官方校验后再 `set()`，不要裸 `as never`）。官方要求**每次 operation 重新 resolve**，凭据轮换立即生效。
  - 工具再（a）直接调 Weread API，或（b）固定 CLI + 固定 argv 模板，经 `ctx.shell.run({ env: { WEREED_API_KEY: value } })` 显式传给子进程——`ShellExecRequest.env` 是官方给进程内插件的普通环境通道，显式 credential-shaped 值会在 subprocess 清洗**之后**合并，**不会被 `scrubbedParentEnv()` 删掉**，所以**原始名可用**。
  - **窄工具铁律**：模型不能指定任意 command/env；CLI/argv 由插件固定、从结构化参数生成、不拼 shell 字符串；secret 不进工具结果/错误/日志；**每次 resolve、不留缓存**；若直接 HTTP，拒绝带凭据的自动跨域重定向。
- **凭据空间修正（统一）**：环境变量式 API key 用 **CredentialRef**（`credentialRef(key)` + `resolve()` + `set(ref, value)`）；仅当目录决定拥有结构化 grant record 时才用 `credentialKey()`/`readRecord()`/`modifyRecord()`（地址形如 `capability-catalog/<id>`）。`skills.ts` 的 `describeRecord(decl.key)` + `remote.ts` 的 `set(request.key as never, …)` 需一并修正到 ref 空间。
- **安全边界**：B 把 resolve 出的 secret 只投进**那条固定的窄子进程**（或结构化 API 调用），不暴露给模型可见的 shell/输出；比 A 的「全集对 scope 内所有 shell 可见」清晰得多。
- **upstream 候选**：dsh-skill 显式声明「skill 需要哪些 env/凭据」并可绑定 narrow tool；非阻塞。

### 5) skill 新增入口（列表顶部按钮，已落地）

- 目录「新增 skill」按钮（置于顶部 heading 旁）→ 打开新增弹窗，**不做手填名称/描述**，选来源：
  1. **上传压缩包（.zip）**：host 半解压到受管目录 → 自动识别 `SKILL.md` 与 frontmatter → filesystem watcher 自动发现注册。解压用**零依赖 zip 读取器**（`src/zip.ts`，node:zlib 的 `inflateRawSync`），仅解 store/deflate，跳过目录，精防路径穿越；
  2. **粘贴 SKILL.md**：文本直接写 `<root>/<name>/SKILL.md`。
  3. **GitHub 克隆**：暂缓（`channel==='github'` 在 v1 返回未接线）。
- **受管目录**：默认 `$DSH_HOME/skills/<name>/`（`source='user-dsh'`，rank 400）；可切换项目级 `.agents/skills/`（`source='project-agents'`，rank 200）。导入的 skill 落盘受管区，来源显示「用户 / 项目」。
- **「是否进模型 catalog」在新增时可选**（写 `disable-model-invocation: true`），直接回应"并非所有 skill 都要默认加载"。
- **信任模型**：上传压缩包 / 粘贴 = 本地信任域内容，与装插件同级（README 写明）；解包只取 `SKILL.md`，不执行包内脚本。
- **已知边界 → 已解除**：web-app bundle 把 host-global skill-filesystem 移到 agent preset scope，故裸 `snapshot()`（host-global）只暴露 runtime skills。目录已用 `agentPresets.standingKeyFor(defaultId)`（host 无 agent 读取者的官方 seam）作为快照与 `get()` 的 scope——网格与详情现在都看到官方/插件/用户全三类（如 user-dsh 的 `wechat-reading`/`sample-skill`、runtime 的 `inline-html-card`）。当 presets 服务缺失时降级为仅 global 层。

### 6) npm 分发 skill：独立提案（本包不实现）

- **方案 C**（评审选定）：npm 包即 cordis 插件，apply 时 `ctx.skills.register()`；`dsh plugin add <pkg>` 就是现成安装/卸载/版本管线，安装器代码为零。来源落 `source='runtime'`，目录用包名标注「npm 插件渠道」。
- 带 API key 的 skill：dsh 有原生 `ctx.credentials`（`<scope>/<id>` 双段、env/file/project-env/user-env 四层来源、GUI 可配且值不上 wire）——cordis 插件形态的 skill 可用 `credentialKey(scope, id)` 注册自己的 scope，比 skills.sh 的环境变量约定更正规。
- 信任模型：npm 装 skill = 装代码，与装任何插件同级（README 写明）。
- 单独开 proposal（skill 包模板 + 文档 + 信任模型），不占本包代码。

## 里程碑

- **M1（本提案 v1，已落地）**：host 采集器（skills 快照 + tools 三层归因 + MCP 交叉验证）+ `list_capabilities` 工具 + Remote + `settings.section` GUI（**三列预览网格 + 居中详情弹窗**：完整 desc + 来源/provider/调叫面 + SKILL.md 源码 + metadata + 凭据配置块）+ 白名单生成脚本 + **skill 新增入口（上传 zip / 粘贴 SKILL.md，可设是否进 catalog，落受管目录；GitHub 克隆 v1 暂缓）**。交付 `@khorsheed/dsh-capability-catalog`。
- **M2（后续）**：npm 分发方案 C（独立提案）；目录导出/复制命令；`metadata.credentials` 约定如需官方支持则走 upstream 提议。

## 验收标准（done 判定，绑定可插拔交付）

1. `dsh plugin add` 一键安装、`dsh plugin remove` 一键卸载，**零官方代码改动**；卸载后无残留（runtime 注册随 effect dispose 干净，skill/tool 均无泄漏）。
2. 真实 profile 中：目录能列出全部官方内置工具（白名单命中）、MCP server 的工具（含 serverName 含下划线的歧义 case 解析正确）、插件注册的工具（`tools/change` 差分标注 plugin）；skill 列表渠道字段与 `$DSH_HOME` 实际目录一一对应。
3. 「配置了但 0 个工具的 MCP server」能在目录中可见并标注（诊断价值验收点）。
4. 浏览器实测：settings.section 页面渲染、筛选/刷新工作、console 零错误；`list_capabilities` 可被模型调用并返回正确 JSON；**skill 详情阅读器能渲染 SKILL.md 正文与 metadata；带声明凭据的 skill 显示凭据区、可填入、值不上 wire**。
5. 官方依赖缺失时（如 `skills` / `credentials` 服务未装）插件降级为空态或跳过对应区块，不拖垮 boot。
6. 构建与单测全绿（`pnpm run build && pnpm run test`），README 双语含信任模型与 `dsh.compat` 标注。

## 风险 / 放弃的东西

- **工具归因非 100% 精确**（白名单漂移、插件用 snake_case 命名）：用置信度标注 + 时间差分缓解；长期正解是 upstream 给 `ToolDefinition` 加 `source` 字段（可登记 upstream-seam-registry，不阻塞本提案；届时本插件的归因层平滑退役）。
- **废**：npm 分发（独立提案）；MCP prompt → skill 映射（官方 mcp-client 全仓不消费 prompts/resources，需自起连接，成本高收益低——值得记入 proposals 素材但不做）；工具调用/管理（只读）；改 MCP server 配置；**skill 内容在 GUI 内编辑**（markdown 编辑器工程量大，编辑走文件系统）。
- **`metadata.credentials` 是自定义约定**：dsh 官方无「skill→credential」映射，此约定需社区采纳，理想情况下游提议（skill 详情可声明所需凭据）。在官方支持前，本约定为本插件与 skill 作者之间的约定，README 写明格式。
- **profile 路径读取**：实现时验证 app-boot 的 profile 解析 API；不可用时降级为「读 `$DSH_HOME/profiles/*/cordis.patch.yml` 文件」或跳过 MCP 交叉验证（只留前缀归因），不阻塞其余功能。
- **GitHub 导入的 frontmatter 兼容性**：真实 skill 仓库可能不符合 dsh 命名/描述约束；失败时给可读提示，不自动改写用户内容。
