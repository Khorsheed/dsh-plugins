# @khorsheed/dsh-capability-catalog

运行中的 dsh 实例里所有 skill 与 tool 的目录，含各自的注册渠道（官方内置 / 项目 / 用户 / 自定义 / 插件运行时）。驱动一个独立设置 tab（工具与技能）和一个模型可调的 `list_capabilities` 工具。

[English](README.md) | 中文

## 展示什么

- **Skills**：三列预览网格（名字 + 一行描述 + 来源/provider 徽标）。点卡片弹居中详情：完整描述、来源/provider/调用面 meta、**统一源码浏览器**（左文件树 + 右内容窗格；内容合成型 skill 渲染成单个虚拟 `SKILL.md` 节点）、frontmatter metadata，以及**凭据配置块**——从 `metadata.credentials` 与正文里的 `$ENV` / `process.env.X` / `env['X']` / `{{env:X}}` 引用解析出的每个 env（值不上 wire）。
- **Tools**：折叠卡 + 渠道归因（`mcp__` 前缀 / 生成的官方白名单 / apply 时序差分）。
- **新增 skill**：一个弹窗三来源——
  - **文件上传**：拖拽（或点选）单个 `SKILL.md`、含 SKILL.md 的 `.zip`、或整个 skill 文件夹（零依赖 `node:zlib` 解压）。
  - **命令安装**：填 `owner/repo`、git URL 或 `npx skills add <repo> -g` 表单——host 提取 repo 做 `git clone` 进用户/项目 skill 根，并把嵌套的 `SKILL.md` 抬到 `<root>/<name>/`（dsh 原生安装；真 `npx skills add` 会装到 dsh 扫不到的外部目录）。
  - **从本机目录**：本地 skill 目录可列出（每个 `<name>/SKILL.md`），用户勾选要装的，host 拷贝到受管根。

每个来源都可选目标根（`$DSH_HOME/skills` / `.agents/skills`）与是否进模型 catalog；skill-filesystem watcher 自动发现结果。

目录用 **agent preset 的 standing scope**（`agentPresets.standingKeyFor(defaultId)`）读 skill registry，列出的官方/插件/用户技能与模型一致；`list_capabilities` 工具跑在调用方的 agent scope。

零 host 改动。`ctx.skills` / `ctx.tools` / `ctx.credentials` / `ctx.agentPresets` 缺失时降级为空态，不拖垮 boot。

## skill 凭据 env 注入

把某 skill 声明 env 变量对应的「已配置凭据」暴露给模型 shell，让 skill 能查询。两块，都**服务无关且通用**（从每个 skill 自己的 env-decl 动态推导，无硬编码 key）：

- **`ctx.shellEnv`** 把每个已配置凭据作为可信、逐执行的 **`DSH_<KEY>`** 变量注入。模型用 shell 展开引用（`KEY="$DSH_KEY" <cmd>`），所以原始值**默认不进模型上下文**（只有模型主动 echo 时才可见——是 **default-hide**，不是硬密码边界）。`ctx.shellEnv`/`ctx.credentials`/`ctx.skills` 缺失或会话无 skill 时是 no-op。
- **运行时 companion 提示**——模型不会自己推导 `KEY → DSH_<KEY>` 别名。当 `skill` 工具加载某个有已配置凭据的 skill 时，目录通过 `tools/post-execute` + `additionalContexts` 附加按 skill 生成的说明，列出每个映射与用法。**从不改用户的 SKILL.md**。

凭据库是 dsh 官方 store（`.credentials.yaml`，ref 空间）；读用 `credentials.resolve(decl.key)` / `describe(decl.key).configured`（仅 presence，绝无值），写 `set(request.key, value)`，用本地 POSIX ref-name 校验（**不**做运行时 `@deepseek-ai/dsh-credentials` import，保持缺失时优雅降级）。

安全取舍（如实）：这是 **default-hide**，不是秘密边界——提示仍可让模型 `echo $DSH_KEY`。若需「模型永不持有原始值」，catalog 自有窄工具（`ctx.shell.run({ env })`）或未来 masked-credential-proxy 设计是更硬的边界；见提案 §4.6。

## 插件 skill 注册协议

这是目录渲染 skill 文件树所依赖的契约。

skill 有两种被发现的方式：

- **文件/提供者发现**（`@deepseek-ai/dsh-skill-filesystem` 扫配置根目录里的 `<name>/SKILL.md`）。这类自带 `resourceBase: { kind: 'directory', path }`，目录自动列出其 bundle 文件（SKILL.md + references/scripts/assets）。
- **运行时插件注册**（`ctx.skills.register(...)`）。目录只有在你**暴露了 bundle** 时才能列出运行时 skill 的文件。

### 规则

如果插件随技能**带资源 bundle**（scripts、assets、references 或 SKILL.md 之外的任何文件），请用资源基址注册：

```ts
ctx.skills.register({
  name: 'my-skill',
  description: '…',
  content: '…',                  // SKILL.md 正文
  source: 'runtime',
  provider: 'my-plugin',         // 可选；目录卡片的标签
  resourceBase: {                // 暴露 bundle 以便浏览
    kind: 'directory',
    path: <插件包 skills/<name> 目录的绝对路径>,
  },
})
```

当 `resourceBase.kind === 'directory'`，目录会 walk `resourceBase.path` 并把 bundle 显示成文件树，模型的相对资源解析也能触达这些文件。**有意不做**"目录去扫所有插件包"：registry 才是"装了哪些"的真相源，它已把每个 skill 归属到 provider。

**内容合成型** skill（单个自包含的 SKILL.md 正文，无 scripts/assets/references，如 `inline-html-card`）**应省略 `resourceBase`**，而不是指向一个只有 SKILL.md 的目录。浏览器半会把这种 skill 渲染成一个**虚拟单节点 `SKILL.md`**（正文即内容）——所有 skill 统一的源码浏览器，host 也不用为"并非真实资源 bundle"的东西伪造磁盘路径。数据契约保持诚实：**只有存在 bundle 时才报 `files`**。

harness 的 `@deepseek-ai/dsh-skill` 已文档化 `resourceBase` 与 `register()` / `registerProvider()`；本节是**目录侧的契约**，把插件侧的期望讲明。（上游候选措辞：建议 dsh-skill 明确"带 bundle 资源的运行时插件技能应携带 `resourceBase` 目录"。）

## Compatibility

| Host 线 | 结论 |
|---|---|
| npm 发布（≥ `0.1.2-rc.1`） | 支持 |
| deepseek-harness master | 支持（`verifiedHost: 0.1.2-rc.1`） |

机器可读：`package.json` 的 `dsh.compat.minHost`（当前 `0.1.2-rc.1`——地板随 0.1.2 基线迁移前移；旧宿主请停留在旧发布线）。若上面省略了降级项，请在 `dsh.compat.notes` 里注明。
