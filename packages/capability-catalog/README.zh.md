# @khorsheed/dsh-capability-catalog

运行中的 dsh 实例里所有 skill 与 tool 的目录，含各自的注册渠道（官方内置 / 项目 / 用户 / 自定义 / 插件运行时）。驱动一个独立设置 tab（工具与技能）和一个模型可调的 `list_capabilities` 工具。

[English](README.md) | 中文

## 展示什么

- **Skills**：三列预览网格（名字 + 一行描述 + 来源/provider 徽标）。点卡片弹居中详情：完整描述、来源/provider/调用面 meta、**统一源码浏览器**（左文件树 + 右内容窗格；内容合成型 skill 渲染成单个虚拟 `SKILL.md` 节点）、frontmatter metadata，以及**凭据配置块**——从 `metadata.credentials` 与正文里的 `$ENV` / `process.env.X` / `env['X']` / `{{env:X}}` 引用解析出的每个 env（值不上 wire）。
- **Tools**：折叠卡 + 渠道归因（`mcp__` 前缀 / 生成的官方白名单 / apply 时序差分）。
- **新增 skill**：一个弹窗三来源——
  - **文件上传**：拖拽（或点选）单个 `SKILL.md`、含 SKILL.md 的 `.zip`、或整个 skill 文件夹（零依赖 `node:zlib` 解压）。
  - **命令安装**：填 `owner/repo`、git URL，或整条 `npx skills add <repo> [--skill <名字>]` 命令——参数会被消费，绝不进入克隆 URL。浏览器里复制的链接可直接粘贴：`github.com/owner/repo`、带仓库内路径的 `github.com/owner/repo/skills/<name>`、以及 `tree/<分支>/…` / `blob/<分支>/SKILL.md` 形状的 URL 都会归一到同一个克隆，开头的 host 会被剥掉（不再被当成 owner），仓库内路径只在该路径下搜索而不是全仓扫描。只有 `github.com` 会拆成 owner/repo；其他 host 的整条路径就是仓库本身（GitLab 子组），按原样克隆。只给 host 不给仓库、路径在仓库里不存在、克隆失败，各有各的报错。host 克隆到临时目录，再把选中的技能包抬到 `<root>/<name>/`（dsh 原生安装；真 `npx skills add` 会装到 dsh 扫不到的外部目录）。仓库含多个技能时用 `--skill` 指定；不指定会报错并列出可选项。
  - **从本机目录**：本地 skill 目录可列出（每个 `<name>/SKILL.md`），用户勾选要装的，host 拷贝到受管根。

每个来源都可选目标根（`$DSH_HOME/skills` / `.agents/skills`）与是否进模型 catalog；skill-filesystem watcher 自动发现结果。

目录用 **agent preset 的 standing scope**（0.1.5 宿主线的 `agentPresets.standingKeyFor(defaultId)`，rc.1 的租约式 `agentPresets.acquireScope(defaultId)`——见 [Compatibility](#compatibility)）读 skill registry，列出的官方/插件/用户技能与模型一致；`list_capabilities` 工具跑在调用方的 agent scope。`snapshotFor(presetId)` 以同样的方式读**任何别的** preset 的 scope——见[能力指纹](#能力指纹)。

零 host 改动。`ctx.skills` / `ctx.tools` / `ctx.credentials` / `ctx.agentPresets` 缺失时降级为空态，不拖垮 boot。

## 模式视图

每个会话都由一个 **agent preset**（界面上的「模式」）组合而成：内置的 标准/PTC/极简/创造，加上部署或用户自建的 preset。不同模式注册的 skill 与 tool 各不相同，**搜索/排序旁边的模式选择框**就是把这个差异摆出来的地方：

- 选中某个 preset，目录就按**该 preset 的 standing scope** 读（`snapshotAt(presetId)`），网格**就是那个模式的能力面，不再合并任何东西**——只投递给写作模式的 skill 不会出现在开发模式下，标签页上的计数也是这个模式的计数；
- **全部模式（对比）** 一次调用读回每个模式的能力面（`modeFaces`），显示并集，每张卡片上带一排模式 chip 标明哪些模式会加载它——也就是「这个 skill/tool 出现在哪些模式下」，点 chip 直接切到那个模式。七个模式时这排 chip 依然紧凑：**每个可读模式都加载**的能力折叠成一颗 `全部模式 · 7`；部分匹配但很长时只显示两颗 chip + `+N`，`+N` 就地展开（只给 title 能回答「还有哪些」，但点不进去）。

读不到的模式（组合失败、roster 解不出 standing scope）保留自己的行并标为「无法读取」，而不是渲染成空面：**「这个模式什么都没有」和「这个模式读不出来」是两回事**，把两者混起来的对比会低估某个能力实际可用的范围。

**没有声明 `presetScope` 的受管 skill** 会投递给每个 preset，因此每个模式都能看到。而范围指向本部署没有的 preset、或投递被同名副本拒绝的受管 skill，不属于任何模式的能力面；技能页此时会在下方给一条诊断（`N 个受管 skill 未在任何模式生效`），展开后点卡片进详情即可改范围或释放。没有这条出口，"按模式过滤"就不只是隐藏，而是让这类 skill 彻底够不着。

读一个模式**不是免费的**：解析 preset 的 standing scope 会**挂载**它的组合（roster 的 single-flight standing mount），所以没挂载过的 preset 会在第一次读时被组合出来。默认模式在实践中早就挂着（当前会话跑在它上面），而对比会把其余每个模式都组合一遍——所以它是一次显式选择，而不是打开面板就做的事。客户端每个会话只读一次能力面（single-flight 缓存，和详情弹窗共用），所以对比过的面板秒开。没有更便宜又诚实的来源：组合文件只写这个模式**点名了哪些插件**，不写这些插件跑起来注册了哪些 tool 和 skill。

详情与删除跟着同一个读位置走：点卡片读的是该卡片来源模式下的详情与技能包，删除同样针对这个模式（同名 skill 在别的模式下可能解析到另一个包）。

卡片徽标标的是**来源**（插件 / 内置 / 用户 / 项目 / 自定义）；受管 skill 的 `preset` 范围是策略不是来源，所以只在"范围就是主题"的地方出现——未生效清单和详情弹窗。

### 只有 host 会写入的地方才可编辑 preset 范围

skill 详情弹窗的「生效的 preset」区块是把 `presetScope` 写进**受管根**里某个 skill 的 frontmatter，所以只有两种形态可配置。该区块会说明自己属于哪一种，而不是给一个 host 必然拒绝（`"<name>" is not a managed skill`）的「保存」：

| skill | 该区块显示 |
|---|---|
| 在受管根里 | preset 勾选网格 + 保存 + 释放回用户技能目录 |
| 用户 / 项目 / 自定义根 | preset 勾选网格 + 移入受管目录并可限定 preset（没有「保存」：勾选就是 adopt 装进去时的范围） |
| 插件提供（`runtime`） | 说明为什么不能设，**并列出实际加载它的模式**（chip，取自共用的能力面缓存——把模式选择器回答的问题，在它回答不了的地方问出来："它到底在哪生效？"） |
| 内置（`bundled`） | 说明为什么不能设——跟随部署组合 |
| 该部署没有 preset 名单 / 没有受管投递 | 不可用提示 |

弹窗的 **frontmatter metadata** 区块只打印「没有专用界面」的 metadata 键：`presetScope`（上面的编辑器）和 `credentials`（凭据表单）不再重复出现，所以仅仅声明了凭据的 skill 不会多出一块原始 JSON。它的位置在凭据表单之前，而不是紧贴源码浏览器；键名命中 `key|token|secret|password` 的值显示为 `···`。

## 能力指纹

snapshot 是一份**清单**——注册序、给人读的措辞、文件 mtime。把「不是能力的东西」去掉之后剩下的才是**能力面**，`hashOf` 是它的 sha256：

| 行 | 进哈希 | 不进 |
|---|---|---|
| skill | `name`、`source`、SKILL.md 正文的 sha256 | description、whenToUse、provider、`updatedAt` |
| tool | `name`、`channel`、`parameters` | description、confidence、owner |
| mcpServer | `name` + 它的工具**名单** | 工具数（可从行推出） |
| channel | 名单 | 计数（可从行推出） |

每个列表按 name 排序，摘要取在规范 JSON 上——同样的东西按不同顺序注册，哈希相同。排除项本身就是主张：**措辞不是能力**。改一句工具描述改的是模型读到的字，不是它能做的事；一个「改错别字就换个哈希」的指纹当不了身份。技能**正文**相反（它就是那套流程），所以以 sha 进入。

```ts
import { hashOf, capsTag } from '@khorsheed/dsh-capability-catalog'

const face = await remote.snapshotFor('eval-lean')   // sha 已盖好
capsTag(face.sha)          // 'caps:2f8b6d40…'
hashOf(face) === face.sha  // true——`sha` 字段本身不进它摘要的那份规范形
```

`snapshotFor(presetId?, workdir?)` 是指纹动词：按**该 preset** 的 standing scope（0.1.5 的 `agentPresets.standingKeyFor(id)`，rc.1 的租约式 `acquireScope(id)`）读 skill 与 tool 注册表，加载每个技能正文使行带上 `bodySha`，并盖 `sha`。不给 presetId 就读部署默认 preset。`snapshot()` 仍是清单动词——同样的行，不读正文，不出摘要。`list_capabilities` 以 `capabilities` 带回**整面**的标签，即使调用方只要了 skill 或只要了 tool。

**清单降级，指纹拒绝。** preset 的 scope 解析不出来时——没有 roster、id 不存在、composition 挂不起来——`snapshot()` 退回全局层并且**不带** `preset` 标签（设置卡不该因为一行配置坏了就变空）；`snapshotFor()` 则抛错，带上 preset 名与原因。这不是假想：真机上一个 preset 只错了一行，降级版本让两个 roster 着**不同** preset 的 scope 算出了同一个哈希，而且悄无声息。

两处代价要说清楚：算指纹时每个技能多读一次正文（清单那条路不读）；问一个还没人组过的 preset 会把它**挂起来**——「该 preset 的 scope」本来就只有挂了才存在。

谁在用：评测把编排实例自己的哈希记进 `run.meta.orchestrator.capabilities` 做取证；声明了 `preset` 的条件必须在 lock 里带上其已配环境的哈希——正是这一步把声明从「一句话」变成「一个事实」。

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
| npm 发布（≥ `0.1.5-rc.1`） | 支持 |
| npm `0.1.7-rc.1` / deepseek-harness master | 支持（`verifiedHost: 0.1.5-rc.1`） |

按模式的能力面读取（模式下拉、`snapshotAt` / `snapshotFor` / `modeFaces`、按 preset 的技能投递）按宿主线走两条 roster 面解析 preset 的 standing scope：0.1.5 的无租约 `standingKeyFor`，rc.1 的租约式 `acquireScope`——rc.1 删除了 `standingKeyFor`，本次双线修复前的目录版本在 rc.1 上全部静默读成全局层。清单与指纹两条路径每次读完都释放租约；strict/降级措辞两线逐字一致。

机器可读：`package.json` 的 `dsh.compat.minHost`（当前 `0.1.5-rc.1`；旧宿主请停留在旧发布线）。若上面省略了降级项，请在 `dsh.compat.notes` 里注明。
