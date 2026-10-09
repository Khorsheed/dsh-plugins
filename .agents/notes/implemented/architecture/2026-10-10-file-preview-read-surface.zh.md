# Agent Note: file-preview 读取接入面——Remote 面与准入接缝共用同一份核心

Status: implemented

## Problem

按授权范围消费社区插件的服务端调用方，需要对它**已经授权**的会话使用 file-preview 的三个读动词（`list`、`turnFiles`、`read`）——但 Remote 面吃 `agent: Agent`，经宿主统一 Agent 查找解析，而那会**唤醒离线会话**：成员经 wire 发起的任何查询都可能惊动目标宿主上的会话。插件从 Agent 身上只读三样东西——`session.snapshotEvents()`（折叠输入）、`session.header.cwd`（路径锚点）、`session.id`（采集器键与图片路由槽）——全部可以不靠会话运行时对象拿到，但包没有暴露这层胶：折叠、读取分类、bash 写入合入都长在 Remote 方法体内，不过 wire 够不着。

## Decision

全部为增量演进：不加 Remote 动词、不动 wire、不消费此接缝的部署行为零变化。版本保持 0.4.1。

- **核心是抽出来的，不是抄出来的**（`packages/file-preview/src/read-surface.ts`）。`list` / `turnFiles` / `read` 的方法体原样搬成自由函数，参数化的正是方法实际读取的东西——fs 面（`FilePreviewReadFs`，`ctx.fs` 形状中 `resolve` / `stat` / `readByteRange` / `readBytes` 的子集）、cwd 锚点、各项上限、图片地址签发器——Remote 方法变成解开 `agent.session` 后调用同一组函数的薄包装。agent 路径与无 agent 路径的一致性因此是构造出来的；扩展名分类器、有界字节窗读取、scripted-HTML 提示随核心一起搬走（图片路由把 MIME 表 import 回来）。
- **工厂** `createFilePreviewReadSurface`（包根导出，仿 canvas 工作区接入先例）吃一份 `FilePreviewReadSource`——`events()`（升序 seq 的会话事件，每次调用重读；固定快照或包一层 `sessionId → events` 查找皆可）、`cwd`、`fs`、可选的 `imageUrl` 签发器，以及与服务配置同名同默认的各项上限——返回 `{ list, turnFiles, read, readImageBytes, dispose }`，产出现有结果形状。授权完全在调用方：接入面自身不做任何准入检查，也从不构造、解析或唤醒会话运行时对象——它手里没有 session id，结构上造不出遗留的 `/file-preview-image/<sessionId>/...` 路由。
- **bash 写入一致性走同一条管线**：`BashWriteCollector` 新增 `replaySnapshot(cwd, events)`——live 事件流 replay 的快照孪生，同一套提取、shell 展开、stat 验证按事件顺序跑，每次验证都 await（live 路径重构为共享 `#verifyInto`；采集器的 fs 选项放宽为它实际使用的 `resolve` | `stat` 子集）。捕获从同一份会话事件重建，合入结果逐字节一致。
- **图片**：注入签发器时，图片 `read` 结果把签发的地址放进既有的 `url` 字段（客户端照常渲染 `read.url`，受控地址零 UI 改动落地；签发器对某个路径返回 `undefined` 时仅该次读取降级）。`readImageBytes(path)` 是最小授权字节读——同锚点、同围栏、同 `maxReadBytes` 上限，返回字节与 MIME——供消费方经自己的鉴权通道发字节；失败分类与 `read` 一致（`missing` / `too-large` / `error`）外加 `not-image`。不注入签发器时，图片读取与 headless 现状完全一致地降级为 `kind: 'binary'`。
- **围栏是继承的，不是重写的**：两条路径用同一个 `fs.resolve` 加同一个锚点，`..` 逃逸、symlink 行为、`missing` / `too-large` / `error` 分类逐字一致。
- **生命周期**：除水印缓存（按回合折叠与重放的捕获，按最后一条事件的 seq 失效——服务自己的纪律）外纯无状态；缓存随返回实例作用域，`dispose()` 即弃（面仍可用，会重新派生），无定时器、无后台工作。
- **本地行为**：遗留图片路由与绑 agent 的动词逐字节不动。唯一一处防御性调整：`list` / `turnFiles` 包装读 `agent.session.header?.cwd`——抽核心前的代码只在存在性探测里碰 cwd，空折叠根本走不到那一行，而既有套件里那个无 header 的会话 double 正好钉着这份宽容。

## Alternatives considered

- **facade `Session` / `Agent`（canvas `workspaceSession` 先例）**：canvas 需要 facade，是因为它的写入要过 `sandboxPolicy.resolve` → `sessionProjections.stateOf` 链，那条链真的读 Session 成员。file-preview 的读取路径没有策略链——事件、cwd、fs 就够了——造一个运行时对象只会白添一处 cast 边界、还把「不唤醒」保证弄含糊；直接注入这三样让「够不到 Agent」成为结构事实（并由测试在源码上钉死）。canvas 先例仍然提供了形状：包根工厂、服务器可信配置、零 Remote 改动。
- **按 session id 键的新 Remote 动词**：wire 面每个客户端都要背，typert 生成面跟着涨，而消费拓扑本来就是进程内调用；何况 session-id 键的动词以后还会诱惑宿主侧再实现一次查找。
- **让消费方自己重写折叠**：折叠/合入/分类逻辑抄第二份会悄悄漂移（bash 写入合入与按回合归因都很微妙）；构造出来的一致性胜过约定出来的一致性。
- **跨实例共享捕获缓存**：拒绝——授权不同的来源绝不能共享派生态；按日志水位键的逐实例缓存把每个面的派生限制在它自己的注入来源内，`dispose()` 随实例一并退役。

## Consequences

- 包根新导出 `createFilePreviewReadSurface`（同时也是 `src/read-surface.ts` 的默认导出）与类型 `FilePreviewReadSource`、`FilePreviewReadSurface`、`FilePreviewReadFs`、`FilePreviewImageBytes`；核心函数（`listFilePreview`、`turnFilesFilePreview`、`readFilePreview`、`readFilePreviewImageBytes`、`retainExistingFiles`、`eventsWatermark`）是供服务使用的模块导出，不进包根。
- `BashWriteCollectorOptions.fs` 放宽为 `Pick<FileSystem, 'resolve' | 'stat'>`（向后兼容）；`replaySnapshot` 公开，且不在 live 注册表里留任何东西。
- 197 个既有测试全部原样通过；12 个新契约测试（共 209 个）钉死：同一 fixture 会话上 list/turnFiles/read 一致（含从事件合入的 bash 重定向写入）、逃逸尝试的分类一致性、签发器地址与逐路径降级、字节读分类与上限、水印失效、dispose 弃缓存、无会话运行时查找的源码钉、空日志形状。
- 接缝随 0.4.1 线发布，不涨版本号；消费侧协作插件仍欠它自己的准入层（按成员派生授权来源）——本包刻意不做任何准入。

## Testing

`packages/file-preview/tests/read-surface.spec.ts` 在带围栏的 fs double 上让两条路径跑同一个 fixture 会话：`list` / `turnFiles` / `read` 结果用 `toEqual` 比对（外加具体抽查，防止两边一起错也过关），逃逸尝试（`../`、嵌套 `..`）在两条路径上分类一致且从清单剔除，签发器行为，字节读成功与失败分类，日志增长后的缓存失效，dispose（经 replay 的无 options resolve 调用计数观测），capture 开关，以及一条源码扫描断言 `src/read-surface.ts` 不含任何会话运行时查找（`@deepseek-ai/dsh-agent`、`agents.get`、`resolveAgent`、`.resume(`）。
