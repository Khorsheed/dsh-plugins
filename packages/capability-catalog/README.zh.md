# @khorsheed/dsh-capability-catalog

运行中的 dsh 实例里所有 skill 与 tool 的目录，含各自的注册渠道（官方内置 / 项目 / 用户 / 自定义 / 插件运行时）。驱动一个独立设置 tab（工具与技能）和一个模型可调的 `list_capabilities` 工具。

[English](README.md) | 中文

## 展示什么

- **Skills**：三列预览网格（名字 + 一行描述 + 来源/provider 徽标）。点卡片弹居中详情：完整描述、来源/provider/调用面 meta、**源码分栏**（左文件树 + 右内容窗格，worktrees 仓库文件样式）、frontmatter metadata，以及 `metadata.credentials` 声明的**凭据配置块**（值不上 wire）。
- **Tools**：折叠卡 + 渠道归因（`mcp__` 前缀 / 生成的官方白名单 / apply 时序差分）。
- **新增 skill**：弹窗从上传 zip（零依赖、`node:zlib` 解压）或粘贴 `SKILL.md` 安装到用户/项目 skill 根，skill-filesystem watcher 自动发现。GitHub 克隆 v1 暂缓。

目录用 **agent preset 的 standing scope**（`agentPresets.standingKeyFor(defaultId)`）读 skill registry，列出的官方/插件/用户技能与模型一致；`list_capabilities` 工具跑在调用方的 agent scope。

零 host 改动。`ctx.skills` / `ctx.tools` / `ctx.credentials` / `ctx.agentPresets` 缺失时降级为空态，不拖垮 boot。

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

| 宿主版本 | 结论 |
|---|---|
| npm 发布（≥ `dsh.compat.minHost`） | 支持 |
| deepseek-harness master | 支持 |

机器可读：`package.json` 的 `dsh.compat.minHost`。若上面省略了降级项，请在 `dsh.compat.notes` 里注明。
