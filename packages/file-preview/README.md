# @khorsheed/dsh-file-preview

[English](README.en.md) | 中文

agent 碰过的文件一页看全：改了什么、现在长什么样。

agent 干了半天活，到底动了哪些文件、改成了什么样？装了这个插件，右栏向导页会多出「会话产物」入口：这个会话读过、写过、改过的每个文件按最近活动倒序列出；点一个进入详情页——头部与预览栈由共享内容面板渲染（标题行：文件名 + 语言标签 + 复制路径 / 在文件夹打开 / 在 IDE 打开，多 IDE 时是带 app 菜单的分体控件；路径行：路径 + 内容/改动记录与渲染/源码等视图控件；搜索行：内容搜索），内容侧是文档形态（Markdown 渲染成文档、JSON 检查树、CSV 表格、HTML 沙箱分级渲染、代码高亮），改动记录逐次步进回看每一次 write/edit 的 diff。每个回合结束，对话里出现一张小卡片，汇总这一轮改了哪几个文件、各增删了多少行。agent 用 bash 顺手写的文件（heredoc、重定向之类）也一样收进来。整个服务只读——它只看文件，从不动文件。

0.4.0 起宿主 Remote 服务与浏览器界面合并为**这一个包**（此前是 file-preview + ui-file-preview 两个包两行；旧包名 `@khorsheed/dsh-client-ui-file-preview` 已在 npm deprecate）。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview1.png" width="640" alt="「产物」tab 的文件预览：文件列表与内联 markdown 预览">

## 功能

- **右栏「产物」页（双线一致）**——page-type 右栏 tab（向导页进入）兼认领方：会话写入或编辑过的每个文件按最近活动倒序、可搜索；点行进入详情页。0.1.5 与 0.1.7-rc.2 同一份形态。tab 类型以 `dsh-resource://file/**` + 可渲染后缀认领，extension 档压过官方 document tab 的 fallback 档（纯静态判定无冷启动窗口）；pdf、压缩包等渲染不了的类型自动回落官方 document tab——文件树/mention/回合卡/产物行点击全部落自绘详情页。
- **详情页**——面包屑路径头 + 行动作（复制路径恒定可用；宿主探测到对应应用时另有「在文件夹中打开」= 文件管理器选中该文件、「在 IDE 打开」= 文件级精确打开，split button 下拉可选探测到的任一 IDE）；标题行「重新加载」手势重读当前文件的内容（重读期间旧内容保持显示，失败保留旧内容并走既有错误槽）；「内容 / 改动记录」切换——内容是文档形态预览（含内容搜索），改动记录逐次步进每一次 write/edit 的 diff（官方至今仍无对应维度：workspace-changes 内存态、git-only、宿主重启即失——此维度长期自留，**跟踪上游**）。
- **回合变更卡片（双线）**——每个已完成回合末尾可收起的「N 个产物」卡片（含 bash 捕获，比官方产物行数据全），逐文件列出行数增减；点击走官方打开路由（可渲染地址由本页认领）。list 槽宿主上（0.1.6-alpha.2 起）同槽官方 deliverables 条目（present 卡 + 内存态 changes 卡）被一等 slot 遮蔽压下——回合区只留这张持久全量卡。
- **会话文件清单（宿主 Remote）**——会话 `read`/`write`/`edit` 调用触碰过的每个文件，每次 write/edit 改动附 diff。
- **内容读取**——文件当前文本，超限截断并标记；web 宿主上图片返回浏览器可加载的 URL；二进制、不存在、超限的文件返回分类提示而不是报错。
- **bash 写入采集**——经 `bash` 写入的文件（heredoc、重定向、`tee`、`sed -i`）并入清单，经 stat 验证，宿主重启后自动重建；工作区外的 bash 产物在我们的详情页里内容和改动记录照常可看（走本插件 Remote，官方工作区读覆盖不到）。
- **只读设计**——无会话状态、无写入；宿主重启不丢任何东西。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview2.png" width="640" alt="每个产物的改动记录：逐轮 diff 可翻页回看">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/file-preview3.png" width="640" alt="「产物」tab：会话写过的全部文件一览">

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview
```

0.4.0 起一个包即是全部：宿主行提供 `filePreview` Remote，浏览器半经 `dsh.client` 发现。重启 web 实例后生效；卸载即精确还原：

```sh
dsh plugin --profile web remove @khorsheed/dsh-file-preview
```

> **从 0.3.x 升级**：两行合一——删掉组合里的 `ui-file-preview` 行（`dsh plugin --profile web remove @khorsheed/dsh-client-ui-file-preview`），保留/升级 `file-preview` 行即可。旧组合里针对 `ui-file-preview` 行的 `disabled` 覆盖不再匹配任何行，需要的话改写为 `file-preview`。

## 配置

```yaml
- id: file-preview
  name: '@khorsheed/dsh-file-preview'
  config:
    maxReadBytes: 524288
    maxFiles: 500
    captureBashWrites: true
```

`maxReadBytes` 限制单次 `read`（超限返回 `too-large`），`maxFiles` 限制 `list` 折叠结果——均为正整数，默认 512 KiB 与 500——`captureBashWrites`（默认 `true`）开关 bash 写入采集器。

## Compatibility

| Host 行 | 结论 |
| --- | --- |
| deepseek-harness master（`0.1.7-rc.2`） | ✅ 完整——与 0.1.5 同一形态：自建产物页 extension 档认领可渲染地址（rc.1 的 tab-registry 保留 band 机制）；turnTail list 槽臂附带官方 deliverables 遮蔽 |
| npm release（`>= 0.1.5-rc.1`） | ✅ 完整（`verifiedHost: 0.1.5-rc.1`）——同一形态；turnTail 为 chain 槽时按探测回落 select + priority -1 抢占臂；0.1.5-rc.1 的 PTC 更名已适配（只匹配 `tool/ptc-dispatch`；旧日志由官方 v2→v3 迁移改写到新名） |
| npm release（`<= 0.1.4.x`） | ❌ 不可用——右栏 tab 体系（`ctx.sidebarRightTabs` / `openResource`）随 0.1.5 落地；旧宿主请停留在旧发布线 |

**版本线对照**：0.3.0 起要求宿主 `0.1.5-rc.1` 及以后；宿主 `0.1.2-rc.1` ~ `0.1.4.x` 的用户请停留在 0.2.x 发布线，宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 发布线（末版 `0.1.1`）。minHost 不动：包内没有 rc.1 专有 API（turnTail 的 list/chain 双臂本就有 0.1.5 回退）。

## 已知限制

- **列表是时间点折叠**——没有推送通道；客户端通过重新调用 `list` 刷新。
- **不提供二进制预览内容**——非图片二进制文件只返回 `kind: 'binary'` 及大小。
- **工作区外产物不进官方路由**——bash 写到会话工作区之外的文件造不出 `dsh-resource://file/...` 地址（官方 `file` 资源限定工作区内），列表行带提示标记；但我们自己的详情页不受此限——内容与改动记录照常可看。
- **仅当前会话**——只显示当前所选会话的文件，不是任意文件浏览器。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

`ctx.filePreview`（wire 命名空间 `filePreview`）暴露六个生成的 Remote 方法：

- `capabilities()`——零会话可用性握手，返回 `{ protocolVersion: 1 }`；浏览器半只在握手成功后安装 UI 面。

- `list(agent)`——对 `agent.session.events` 的纯折叠：`read`/`write`/`edit` 的 `tool/call` 贡献展示路径，这些工具的已完结嵌套 PTC `tool/ptc-dispatch` 同样计入（失败的派发不记录；条目借用根调用的 turn/step）。携带 `diffs` 元数据的 `write`/`edit` `tool/result` 把每次改动按事件序追加进条目，`lastDiff` 保留为最后一次。响应携带条目、最后扫描的 seq，以及是否触达 `maxFiles`。折叠本身不访问文件系统；`captureBashWrites` 开启时并入采集器验证过的 bash 写入路径。返回前按会话 cwd 解析每条路径并 `stat`，只保留当前仍存在的常规文件——日志折叠是历史，产物列表只看磁盘现状（某回合写后又清理的临时脚本不再是产物）；存在性每次调用都现查（不随日志折叠缓存）。
- `read(agent, path, signal)`——以会话 cwd 为基准解析 `path`，返回 `kind: 'text'`（超过 `maxReadBytes` 截断并标记 `truncated`）；web 宿主上图片返回 `kind: 'image'` 及浏览器可加载 URL——字节走专门的 `/file-preview-image/<sessionId>/<path>` 路由，仅当组合了可选的 `webServer` 与 `agents` 服务时注册；无 web 宿主返回 `binary`——否则返回分类提示：`binary`（二进制扩展名或 NUL 字节；绝不读取）、`missing`、`too-large`、`error`（含消息）。
- `reveal(agent, path, signal)`——在宿主文件管理器中打开文件所在文件夹并选中它，全程无 shell，走 `@deepseek-ai/dsh-native-command`：macOS `open -R`、Windows `explorer /select,<path>`、WSL 经 `wslpath`、桌面 Linux 依次尝试 `nautilus`/`dolphin`/`nemo --select`。选中返回 `{ revealed: true }`，否则 `false` 及 `reason: 'missing'`（目标不存在）或 `'select-failed'`（无可用文件管理器——调用方改开父文件夹，手势总能落在可见处）。不写入任何东西。
- `openExternal(agent, path, app, signal)`——在指定宿主应用中打开文件（「在 IDE 打开」手势）：官方 open-in-app 路由只收目录，文件级打开走这里——macOS `open -a <App> <path>`，同样无 shell。`app` 是官方 open-in-app catalog id（客户端经 `/open-in-app/apps` 探测）；id → `.app` 名映射在 `open-external.ts`（镜像官方 catalog 的 darwin 条目）。非 macOS 或未知 id 返回 `{ opened: false, reason }`，客户端据此隐藏手势。不写入任何东西。
- `turnFiles(agent)`——每个回合的文件变更，回合卡片与 `list` 同源但**不**去重：同一文件在两个回合改过，两个分组都有它——每张卡片精确列出该回合改了什么。行数增减由 result diff 求和；折叠按会话缓存、由日志水位线失效，响应携带水位线供客户端自缓存。与 `list` 一样，返回前按会话 cwd 校验存在性，只保留当前仍存在的文件（被清理的临时脚本不占卡片）。

bash 写入采集器：监听每个会话的 bash `tool/call`/`tool/result` 配对，提取高精度写入目标（`cat > path` heredoc、单 `>` 重定向、`tee` 非追加、`sed -i`），按宿主环境与会话 cwd 展开 `$VAR`/`~`/相对路径，只记录 `fs.stat` 确认为文件的路径（宁缺毋滥）。采集结果存于按会话的内存登记表，`session/created` 时重放会话自身历史重建——宿主重启后不丢；会话日志本身绝不被改动（官方 `Session.append` 无法给插件事件标 `ignorable`——见 `docs/upstream-seam-registry.md` 的 S2 条目）。bash 采集的文件没有 diff 历史；预览与普通条目一样通过 `read` 读当前内容。

浏览器半（`src/client/`）：

- `src/client/index.ts` —— apply：挂载 `filePreview` Remote 并执行零会话 `capabilities()` 握手；成功后由 `installFilePreviewSurfaces` 注册所有 UI 面并统一卸载；turnTail 的 list 臂同时注册官方 deliverables 条目的遮蔽体
- `src/client/definition.tsx` —— page-type tab 的注册表定义（guide 入口 + `dsh-resource://file/**` 可渲染后缀认领）与认领后缀清单
- `src/client/FilePreviewTab.tsx` —— 右栏「产物」页（列表 + 详情视图）
- `src/client/preview.ts` —— 适配层：`filePreview` wire kind → 内核 `PreviewRead`、字典适配（详情页的头部与预览栈来自共享内核 `@khorsheed/dsh-client-ui-content-preview`，源码面内联）
- `src/client/DiffHistory.tsx` —— 逐次 write/edit diff 步进（本插件独有）
- `src/client/mentions-wrap.ts` —— mention 打开方向统一进右栏的就地包装（缝 S1 尾巴）
- `src/client/open-in-app.ts` —— 官方 open-in-app 探测（行动作可见性）
- `src/client/TurnFileRow.tsx` —— 每回合的「N 个产物」卡片

纯增量插件：宿主半是一个 Remote 服务，浏览器半经官方 `ctx.remote.$mount` 通道自挂载该 Remote，注册一个右栏 tab 类型（`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab` seat）与一个回合文件行（`conversation.chat.turnTail`——0.1.6-alpha.2 起该槽为 list 语义，本行另注册一条同官方 deliverables cell id、priority -1 的空体遮蔽官方 present/changes 卡——slot 系统一等遮蔽：同 cell 异优先级共存、最低者渲染，官方条目仍在册故其声明的 `deliverables.file.actions` 子槽不塌；0.1.5 宿主上该槽仍是 chain 选举，注册按探测回落为旧的 select + `priority: -1` 抢占形）——原版 dsh 核心零改动即可运行。该命名空间不声明为 inject（自挂载会让加载器死锁）；挂载被 await 后用 `ctx.get('remote.filePreview')` 读回，并先执行零会话 `capabilities()`；只有 `{ protocolVersion: 1 }` 成功返回才安装这些 UI 面，宿主缺席时全部缺席。回合卡片经按会话的客户端缓存读同一个宿主 `filePreview.turnFiles` RPC——卡片与 tab 同一事实源。

0.1.5-rc.1 迁移退役了四处绕行（上游缝 S1 已落地）：`conversation.view` 的「产物」tab、`shell.overlay` 预览抽屉、正文 mention 的捕获阶段 DOM 拦截、turnTail 的 `priority: -1` 抢占——产物行 / 正文 mention / 工具结果行的打开入口官方已统一收敛到 `ctx.sidebarRight.openResource()`。方案 B（2026-09-24 落地、同日被仓主否决回退）：内容面注册进官方 `documentPreviews` 面做官方 document tab 默认渲染器 + 二期 headless 嵌入——接缝成本（renderer loading 协议、extension 档接管语义、headless 布局耦合）与 UX 妥协（改动记录塞进渲染器下拉、复制钮浮动压搜索行）不成立，自绘产物页（地址认领形态）双线恢复；turnTail 遮蔽不在否决范围，保留。

信任与状态：受信任的只读能力——能读取 `ctx.fs` 允许会话访问的一切，组合它即授予对会话文件系统视图的预览权限；它不是安全边界。不产生会话事件；仅有的按会话状态是回合折叠缓存与 bash 采集器的已验证写入登记表。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/file-preview`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
