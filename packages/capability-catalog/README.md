# @khorsheed/dsh-capability-catalog

[English](README.en.md) | 中文

这个 agent 到底会什么、每个工具是谁装的——一个设置页全列出来，新 skill 和 MCP server 当场就能装；模型自己也有 `list_capabilities` 可查。

dsh 的每个会话都由一个 agent preset 组合而成，插件、技能目录、MCP server 都在往里注册能力——但宿主没有任何界面把它们列出来，「这个 agent 能干什么、那个工具从哪来的」以前只能翻日志回答。这个插件补上一个独立设置页（工具与技能）回答给人看，再注册一个 `list_capabilities` 工具回答给模型看。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/capability-catalog-1.png" width="640" alt="「工具与技能」设置页：技能预览网格，带来源徽标、搜索排序与模式选择框">

## 特性

- **技能一览**——三列预览网格（名字、一行描述、来源/provider 徽标），带搜索、排序和 内置/插件/其他 分段过滤。点卡片进详情弹窗：完整描述与调用面 meta、统一源码浏览器（左边 bundle 文件树、右边内容窗格——内容合成型 skill 渲染成单个虚拟 `SKILL.md` 节点）、frontmatter metadata（形似密钥的值显示为 `···`），以及凭据表单——从 `metadata.credentials` 与正文里的 `$ENV` / `process.env.X` / `env['X']` / `{{env:X}}` 引用解析出的每个 env 都可在此配置。值落在 dsh 凭据库，不上 wire。
- **工具带渠道归因**——折叠卡标明每个工具从哪来：作者声明的 origin 标记（精确）、`mcp__` 前缀（精确）、生成的官方工具白名单（精确）、apply 时序差分（推断）。详情弹窗把参数 schema 展示为结构树或原始 JSON。

- **三种方式装技能**——一个弹窗：上传（单个 `SKILL.md`、含 SKILL.md 的 `.zip`、或整个技能文件夹，零依赖 `node:zlib` 解压）；命令安装（`owner/repo`、git URL，或整条粘贴来的 `npx skills add <repo> [--skill <名字>]` 命令——GitHub 仓库内路径与 `tree/`/`blob/` URL 都归一到同一个克隆，只有 `github.com` 会拆成 owner/repo，GitLab 子组按原样存活）；或从本机目录勾选。每个来源都可选目标根（`$DSH_HOME/skills` 或 `.agents/skills`）与是否进模型 catalog；skill-filesystem watcher 会自动发现结果。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/capability-catalog-2.png" width="640" alt="新增 Skill 弹窗：文件上传 / 命令安装 / 从本机目录三种安装方式，每个来源可选目标根与是否进模型 catalog">

- **模式视图**——每个会话都由一个 agent preset（「模式」）组合而成，不同模式注册的 skill 与 tool 各不相同。搜索框旁边的模式选择框按**该 preset 的 standing scope** 读（`snapshotAt(presetId)`）——网格就是那个模式的能力面，不再合并任何东西；「全部模式（对比）」一次调用读回每个模式的面（`modeFaces`），给每张卡片标上加载它的模式 chip，「这个能力出现在哪些模式」一点即达。读不到的模式标为「无法读取」，绝不渲染成空面。
- **按 preset 投递的技能**——插件自管一个受管根（`$DSH_HOME/capability-catalog/skills`），其中技能用 frontmatter `presetScope` 声明属于哪些模式；详情弹窗直接编辑（保存、把已装技能收编进受管根、释放回用户技能目录），不在任何模式生效的受管技能由一条诊断行保持可达，而不是被过滤没了。
- **MCP server 管理**——粘贴一段 `mcp.json` server 配置，弹窗自动解析传输、识别凭据（形似凭据的字段在存储的配置里变成 `secretRef:` 标记，Remote 只回 `configured` 状态——值永远到不了浏览器）。连接后发现该 server 的工具，整台 server 或单个工具都可开关，每个启用的工具都以 `mcp__<server>__<tool>` 注册到 `ctx.tools`，模型当场可调。配置的 server 经 settings 服务跨重启存活。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/capability-catalog-3.png" width="640" alt="新增 MCP 服务器弹窗:粘贴一段 mcp.json server 配置,自动解析传输与凭据">

- **给模型的 `list_capabilities`**——模型可调的工具，列出调用方自己 agent scope 里可见的 skill 与 tool，并盖上能力指纹标签。
- **能力指纹**——`snapshotFor(presetId?)` 加载每个技能正文，对规范化能力面（名字、来源、渠道、参数、正文哈希——措辞不进）盖 sha256；同样的能力按不同顺序注册，哈希相同。`hashOf` / `capsTag` 导出给宿主侧读者。
- **凭据 env 注入**——某 skill 声明 env 对应的已配置凭据，以可信、逐执行的 `DSH_<KEY>` 变量暴露给模型 shell，模型用 shell 展开引用，原始值默认不进模型上下文；`skill` 工具加载这类技能时，运行时提示会把每个 `KEY → DSH_<KEY>` 映射告诉模型，从不改动 `SKILL.md`。
- **工具来源约定**——导出 `setToolOrigin` / `TOOL_ORIGIN`，任何插件在 `ctx.tools.register` 前给工具打标即可获得精确归因；设置页自带一个帮助弹窗，内置可复制的一段话，发给写插件的 agent 就能完成打标。
- **降级，不爆炸**——零宿主改动，全部经 `ctx.get` 探测现有官方服务；组合缺 `ctx.skills` / `ctx.tools` / `ctx.credentials` / `ctx.agentPresets` 时渲染空态，不拖垮 boot。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-capability-catalog
```

重启 web 实例后生效；「工具与技能」出现在设置页，紧随「插件」区块之后。卸载即精确移除挂载行：

```sh
dsh plugin --profile web remove @khorsheed/dsh-capability-catalog
```

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——0.1.5-rc.1 全量 boot 实证通过（42 包含 capture，2026-09-25），经三层兼容修复：[preset-registry 双名探测](../../.agents/notes/implemented/bug-fix/2026-09-25-preset-registry-dual-name-probe.md)、[typert codec 双形状](../../.agents/notes/implemented/bug-fix/2026-09-25-typert-codec-dual-shape.md)、[face 自带 zod@4](../../.agents/notes/implemented/bug-fix/2026-09-25-typert-faces-carry-zod-v4.md)。`minHost` 即 0.1.5-rc.1，且 0.1.95 是本包首个发布——更早的宿主没有可用发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.7-rc.1）——0.1.7-rc.1 同时是 3080 生产实证线。

按模式的能力面读取（模式下拉、`snapshotAt` / `snapshotFor` / `modeFaces`、按 preset 的技能投递）按宿主线走两条 roster 面解析 preset 的 standing scope：0.1.5 的无租约 `standingKeyFor`，rc.1 的租约式 `acquireScope`——rc.1 删除了 `standingKeyFor`，本次双线修复前的目录版本在 rc.1 上会静默读成全局层。清单与指纹两条路径每次读完都释放租约。机器可读字段见 `package.json` 的 `dsh.compat`（`minHost`、`verifiedHost`、`notes`）。

## 已知限制

- **凭据注入是 default-hide，不是秘密边界**——构造的提示仍可让模型 `echo $DSH_KEY`。若要「模型永不持有原始值」，更硬的边界见 [masked-credential-proxy 提案](../../proposals/active/2026-08-29-masked-credential-proxy.md)。
- **未打标的插件工具退回启发式**——作者没设 origin 标记的工具可能被归到「内置」；设置页的「为什么我的插件工具不在这里？」弹窗（与 [docs/tool-origin-guide.md](../../docs/tool-origin-guide.md)）给出了一行的修法。
- **MCP 桥只覆盖文本结果形态**——发现的工具按纯文本进出注册，无图片/附件投影；组合里没有 settings 服务时，MCP server 状态只活在内存里，重启即重置。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**架构。** host 半是 `CapabilityCatalogService`，一个 `capabilityCatalog` 命名空间的 Typert Remote 服务；浏览器半经 `ctx.remote.$mount` 挂载生成的 Remote，再经 `slots.inject` 注册独立 `settings.section` 槽位（id `capabilities`，order 20——紧随「插件」区块），因此 apply 顺序永远不影响。身份三角：`cordis.patch.yml` 的 `capability-catalog` 行 id、npm 包名、`src/invariant.ts` 的 `PACKAGE_NAME`。包根导出服务本体、指纹 helper（`hashOf` / `capsTag` / `canonicalCapabilities`）、preset-scope/投递原语与工具来源 helper；`/client` 导出浏览器插件体。

**渠道归因。** `ToolSchema` 不携带来源字段，所以工具渠道按优先级解析：作者声明的 origin 标记（留在注册表按引用保留的 definition 上的 `Symbol.for('dsh.tool.origin')` 属性，经 `ctx.tools.get(name)` 读回——系统提示投影会剥掉它，所以永不上模型 wire），然后 `mcp__` 前缀（按最长已配置前缀匹配 server 名），然后生成的官方工具白名单（`scripts/gen-official-tools.mts`，由锁定的 harness 检出生成），最后 apply 时序差分。基线在延迟的 `ctx.inject(['tools'], …)` 里取，注册表自己的挂载顺序不可能造成空基线、把每个工具误标成插件。

**模式视图。** 实例把每个会话组合自一个 agent preset：内置的 标准/极简/PTC/创造，加上部署或用户自建的 preset，各自注册不同的 skill 与 tool。选中某个 preset 就按该 preset 的 standing scope 读（`snapshotAt(presetId)`），网格**就是那个模式的能力面**——只投递给写作模式的 skill 不会出现在开发模式下，标签页计数也是这个模式的计数。「全部模式（对比）」一次调用读回每个 preset 的面（`modeFaces`）显示并集，每张卡片一排模式 chip 标明哪些模式加载它；每个可读模式都加载的能力折叠成一颗 `全部模式 · N`，部分匹配但很长时只显示两颗 chip + `+N`，就地展开。读不到的模式（组合失败、roster 解不出 standing scope）保留自己的行并标为「无法读取」，而不是渲染成空面——「这个模式什么都没有」和「这个模式读不出来」是两回事。没声明 `presetScope` 的受管 skill 投递给每个 preset；范围指向本部署没有的 preset 的受管 skill 不属于任何模式的面，技能页此时给一条诊断行（`N 个受管 skill 未在任何模式生效`），展开点卡片进详情即可改范围或释放——没有这条出口，按模式过滤就不只是隐藏，而是让这类 skill 彻底够不着。读一个模式**不是免费的**：解析 preset 的 standing scope 会**挂载**它的组合（roster 的 single-flight standing mount），所以对比是一次显式选择，打开页面绝不做；客户端每个会话只读一次能力面（single-flight 缓存，和详情弹窗共用）。详情与删除跟着同一个读位置走：点卡片读的是该卡片来源模式下的详情与技能包，删除同样针对这个模式。

卡片徽标标的是**来源**（插件 / 内置 / 用户 / 项目 / 自定义）；受管 skill 的 `preset` 范围是策略不是来源，所以只在「范围就是主题」的地方出现——未生效清单和详情弹窗。

**只有 host 会写入的地方才可编辑 preset 范围。** 详情弹窗的「生效的 preset」区块是把 `presetScope` 写进受管根里某个 skill 的 frontmatter，所以该区块会说明自己属于哪一种形态，而不是给一个 host 必然拒绝（`"<name>" is not a managed skill`）的「保存」：

| skill | 该区块显示 |
|---|---|
| 在受管根里 | preset 勾选网格 + 保存 + 释放回用户技能目录 |
| 用户 / 项目 / 自定义根 | preset 勾选网格 + 移入受管目录并可限定 preset（没有「保存」：勾选就是 adopt 装进去时的范围） |
| 插件提供（`runtime`） | 说明为什么不能设，并列出实际加载它的模式（chip 取自共用的能力面缓存） |
| 内置（`bundled`） | 说明为什么不能设——跟随部署组合 |
| 该部署没有 preset 名单 / 没有受管投递 | 不可用提示 |

弹窗的 frontmatter metadata 区块只打印「没有专用界面」的 metadata 键：`presetScope`（上面的编辑器）和 `credentials`（凭据表单）不再重复出现，所以仅仅声明了凭据的 skill 不会多出一块原始 JSON；键名命中 `key|token|secret|password` 的值显示为 `···`。

**能力指纹。** snapshot 是一份**清单**——注册序、给人读的措辞、文件 mtime。把「不是能力的东西」去掉之后剩下的才是**能力面**，`hashOf` 是它的 sha256：

| 行 | 进哈希 | 不进 |
|---|---|---|
| skill | `name`、`source`、SKILL.md 正文的 sha256 | description、whenToUse、provider、`updatedAt` |
| tool | `name`、`channel`、`parameters` | description、confidence、owner |
| mcpServer | `name` + 它的工具**名单** | 工具数（可从行推出） |
| channel | 名单 | 计数（可从行推出） |

每个列表按 name 排序，摘要取在规范 JSON 上——同样的东西按不同顺序注册，哈希相同。排除项本身就是主张：**措辞不是能力**——改一句工具描述改的是模型读到的字，不是它能做的事。技能**正文**相反（它就是那套流程），所以以 sha 进入。

```ts
import { hashOf, capsTag } from '@khorsheed/dsh-capability-catalog'

const face = await remote.snapshotFor('eval-lean')   // sha 已盖好
capsTag(face.sha)          // 'caps:2f8b6d40…'
hashOf(face) === face.sha  // true——`sha` 字段本身不进它摘要的那份规范形
```

`snapshotFor(presetId?, workdir?)` 是指纹动词：按该 preset 的 standing scope 读 skill 与 tool 注册表，加载每个技能正文使行带上 `bodySha`，并盖 `sha`；不给 presetId 就读部署默认 preset。`snapshot()` 仍是清单动词——同样的行，不读正文，不出摘要。`list_capabilities` 以 `capabilities` 带回**整面**的标签，即使调用方只要了 skill 或只要了 tool。

**清单降级，指纹拒绝。** preset 的 scope 解析不出来时——没有 roster、id 不存在、composition 挂不起来——`snapshot()` 退回全局层并且不带 `preset` 标签（设置卡不该因为一行配置坏了就变空）；`snapshotFor()` 则抛错，带上 preset 名与原因。两处代价要说清楚：算指纹时每个技能多读一次正文（清单那条路不读）；问一个还没人组过的 preset 会把它**挂起来**——「该 preset 的 scope」本来就只有挂了才存在。谁在用：评测把编排实例自己的哈希记进 `run.meta.orchestrator.capabilities` 做取证；声明了 `preset` 的条件必须在 lock 里带上其已配环境的哈希——正是这一步把声明从「一句话」变成「一个事实」。

**skill 凭据 env 注入。** 把某 skill 声明 env 变量对应的已配置凭据暴露给模型 shell，让 skill 能查询。两块，都**服务无关且通用**（从每个 skill 自己的 env-decl 动态推导，无硬编码 key）：

- `ctx.shellEnv` 把每个已配置凭据作为可信、逐执行的 `DSH_<KEY>` 变量注入。模型用 shell 展开引用（`KEY="$DSH_KEY" <cmd>`），所以原始值默认不进模型上下文（只有模型主动 echo 时才可见——是 default-hide，不是硬秘密边界）。映射到保留内建名（`DSH_HOME` / `DSH_SHELL` / `DSH_SESSION_ID`）或已被其他贡献者占用的 key 会跳过并告警，一个坏 key 不会拖垮整个注册。`ctx.shellEnv` / `ctx.credentials` / `ctx.skills` 缺失、或会话无 skill 时是 no-op。
- 运行时 companion 提示——模型不会自己推导 `KEY → DSH_<KEY>` 别名，所以当 `skill` 工具加载某个有已配置凭据的 skill 时，目录通过 `tools/post-execute` + `additionalContexts` 附加按 skill 生成的说明，列出每个映射与用法。**从不改用户的 SKILL.md**。

凭据库是 dsh 官方 store（`.credentials.yaml`，ref 空间）；读用 `credentials.resolve(decl.key)` / `describe(decl.key).configured`（仅 presence，绝无值），写 `set(request.key, value)`，用本地 POSIX ref-name 校验——不做运行时 `@deepseek-ai/dsh-credentials` import，保持缺失时优雅降级。

**MCP 管理。** 配置的 server 在两条宿上线都经 settings 服务持久化——0.1.5 的自由形 `settings.register` 命名空间，0.1.7 的 volatile 插件 Config 字段（经 SettingsForms，以 `settings/document-updated` 回合）——settings 缺失时降级为进程内 store。持久化块只存工具名与开关（描述和参数 schema 会撑大 `settings.yaml` 且会过期），所以 boot 时异步重连启用的 server 把它们补回来；boot 不被阻塞，各 server 的错误各自隔离。发现的工具按稳定的 `mcp__<serverName>__<rawName>` 契约注册到 `ctx.tools`，按函数名约束归一化（有损归一时追加 sha256 后缀消歧）；注册是「先 dispose 再 register」的 reconcile，且始终以可追踪服务代理上的成员调用发起 `register`。形似凭据的配置字段变成 `secretRef:` 标记，连接时经 `ctx.credentials` 解析——`mcpSnapshot` 只回 `configured` 状态，标记永不出宿主。

**插件 skill 注册协议。** 目录渲染 skill 文件树所依赖的契约。skill 有两种被发现的方式：文件/提供者发现（`@deepseek-ai/dsh-skill-filesystem` 扫配置根目录里的 `<name>/SKILL.md`，这类自带 `resourceBase: { kind: 'directory', path }`，目录自动列出其 bundle 文件），以及运行时插件注册（`ctx.skills.register(...)`）——后者只有在你暴露了 bundle 时目录才能列出文件：

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

当 `resourceBase.kind === 'directory'`，目录会 walk `resourceBase.path` 并把 bundle 显示成文件树，模型的相对资源解析也能触达这些文件。**有意不做**「目录去扫所有插件包」：registry 才是「装了哪些」的真相源，它已把每个 skill 归属到 provider。内容合成型 skill（单个自包含的 SKILL.md，无 scripts/assets/references）应**省略** `resourceBase`，而不是指向一个只有 SKILL.md 的目录——浏览器半把它渲染成单个虚拟 `SKILL.md` 节点，且只有存在 bundle 时才报 `files`。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/capability-catalog`）。问题与贡献请移步该仓库。
