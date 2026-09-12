# @khorsheed/dsh-file-preview

[English](README.en.md) | 中文

agent 碰过的文件一页看全：改了什么、现在长什么样。

这是文件预览的宿主半。装上它和配套的界面包，web GUI 会多一个「产物」tab：会话里 agent 读过、写过、改过的每个文件都列在里面，每次 write/edit 改动附 diff，点开任一文件就能看到当前内容。agent 用 bash 顺手写的文件（heredoc、重定向之类）也一样收进来。整个服务只读——它只看文件，从不动文件。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview1.png" width="640" alt="「产物」tab 的文件预览：文件列表与内联 markdown 预览">

## 功能

- **会话文件清单**——会话 `read`/`write`/`edit` 调用触碰过的每个文件，每次 write/edit 改动附 diff。
- **内容读取**——文件当前文本，超限截断并标记；web 宿主上图片返回浏览器可加载的 URL；二进制、不存在、超限的文件返回分类提示而不是报错。
- **bash 写入采集**——经 `bash` 写入的文件（heredoc、重定向、`tee`、`sed -i`）并入清单，经 stat 验证，宿主重启后自动重建。
- **在文件夹中打开**——在宿主文件管理器中打开所在文件夹并选中文件，支持 macOS、Windows、WSL、桌面 Linux。
- **只读设计**——无会话状态、无写入；宿主重启不丢任何东西。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview2.png" width="640" alt="每个产物的改动记录：逐轮 diff 可翻页回看">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/file-preview3.png" width="640" alt="「产物」tab：会话写过的全部文件一览">

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview
```

仅宿主半——可见界面（「产物」tab、预览抽屉、回合变更卡片）在配套客户端里：

```sh
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview
```

卸载；如果只残留客户端半，它的零会话握手会失败，全部 UI 面均缺席（不留错误卡或空 tab）：

```sh
dsh plugin --profile web remove @khorsheed/dsh-file-preview
```

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

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——适配 0.1.5-rc.1 的 PTC 更名（只匹配 `tool/ptc-dispatch`；旧日志由官方 v2→v3 迁移改写到新名），全量构建测试通过；minHost 前移至 0.1.5-rc.1，旧宿主请停留在旧发布线。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）

**版本线对照**：0.2.0 之后的首个发布起支持宿主 `0.1.5-rc.1` 及以后；宿主 `0.1.2-rc.1` 请停留在 `0.2.0`，宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 请停留在 0.1.x 发布线（末版 `0.1.1`）。

## Known Limitations

- **列表是时间点折叠**——没有推送通道；客户端通过重新调用 `list` 刷新。
- **不提供二进制预览内容**——非图片二进制文件只返回 `kind: 'binary'` 及大小。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

`ctx.filePreview`（wire 命名空间 `filePreview`）暴露六个生成的 Remote 方法：

- `capabilities()`——零会话可用性握手，返回 `{ protocolVersion: 1 }`；配套客户端只在握手成功后安装 UI 面。

- `list(agent)`——对 `agent.session.events` 的纯折叠：`read`/`write`/`edit` 的 `tool/call` 贡献展示路径，这些工具的已完结嵌套 PTC `tool/ptc-dispatch` 同样计入（失败的派发不记录；条目借用根调用的 turn/step）。携带 `diffs` 元数据的 `write`/`edit` `tool/result` 把每次改动按事件序追加进条目，`lastDiff` 保留为最后一次。响应携带条目、最后扫描的 seq，以及是否触达 `maxFiles`。折叠本身不访问文件系统；`captureBashWrites` 开启时并入采集器验证过的 bash 写入路径。返回前按会话 cwd 解析每条路径并 `stat`，只保留当前仍存在的常规文件——日志折叠是历史，产物列表只看磁盘现状（某回合写后又清理的临时脚本不再是产物）；存在性每次调用都现查（不随日志折叠缓存）。
- `read(agent, path, signal)`——以会话 cwd 为基准解析 `path`，返回 `kind: 'text'`（超过 `maxReadBytes` 截断并标记 `truncated`）；web 宿主上图片返回 `kind: 'image'` 及浏览器可加载 URL——字节走专门的 `/file-preview-image/<sessionId>/<path>` 路由，仅当组合了可选的 `webServer` 与 `agents` 服务时注册；无 web 宿主返回 `binary`——否则返回分类提示：`binary`（二进制扩展名或 NUL 字节；绝不读取）、`missing`、`too-large`、`error`（含消息）。
- `reveal(agent, path, signal)`——在宿主文件管理器中打开文件所在文件夹并选中它，全程无 shell，走 `@deepseek-ai/dsh-native-command`：macOS `open -R`、Windows `explorer /select,<path>`、WSL 经 `wslpath`、桌面 Linux 依次尝试 `nautilus`/`dolphin`/`nemo --select`。选中返回 `{ revealed: true }`，否则 `false` 及 `reason: 'missing'`（目标不存在）或 `'select-failed'`（无可用文件管理器——调用方改开父文件夹，手势总能落在可见处）。不写入任何东西。
- `openExternal(agent, path, app, signal)`——在指定宿主应用中打开文件（「在 IDE 打开」手势）：官方 open-in-app 路由只收目录，文件级打开走这里——macOS `open -a <App> <path>`，同样无 shell。`app` 是官方 open-in-app catalog id（客户端经 `/open-in-app/apps` 探测）；id → `.app` 名映射在 `open-external.ts`（镜像官方 catalog 的 darwin 条目）。非 macOS 或未知 id 返回 `{ opened: false, reason }`，客户端据此隐藏手势。不写入任何东西。
- `turnFiles(agent)`——每个回合的文件变更，回合卡片与 `list` 同源但**不**去重：同一文件在两个回合改过，两个分组都有它——每张卡片精确列出该回合改了什么。行数增减由 result diff 求和；折叠按会话缓存、由日志水位线失效，响应携带水位线供客户端自缓存。与 `list` 一样，返回前按会话 cwd 校验存在性，只保留当前仍存在的文件（被清理的临时脚本不占卡片）。

bash 写入采集器：监听每个会话的 bash `tool/call`/`tool/result` 配对，提取高精度写入目标（`cat > path` heredoc、单 `>` 重定向、`tee` 非追加、`sed -i`），按宿主环境与会话 cwd 展开 `$VAR`/`~`/相对路径，只记录 `fs.stat` 确认为文件的路径（宁缺毋滥）。采集结果存于按会话的内存登记表，`session/created` 时重放会话自身历史重建——宿主重启后不丢；会话日志本身绝不被改动（官方 `Session.append` 无法给插件事件标 `ignorable`——见 `docs/upstream-seam-registry.md` 的 S2 条目）。bash 采集的文件没有 diff 历史；预览与普通条目一样通过 `read` 读当前内容。

信任与状态：受信任的只读能力——能读取 `ctx.fs` 允许会话访问的一切，组合它即授予对会话文件系统视图的预览权限；它不是安全边界。不产生会话事件；仅有的按会话状态是回合折叠缓存与 bash 采集器的已验证写入登记表。

分享：纯宿主侧增量——一个 Remote 服务，由浏览器半经官方的 `ctx.remote.$mount` 通道挂载。浏览器半（`@khorsheed/dsh-client-ui-file-preview`）同样纯增量；两个包独立分发，零改动组合进原版 dsh 核心。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/file-preview`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
