# @khorsheed/dsh-file-preview

[English](README.md) | 中文

面向 Web 界面的只读文件预览 Remote 服务：`list` 把一次会话的日志折叠成其 `read`/`write`/`edit` 工具调用触碰过的文件列表——包括这些工具的嵌套 Code Mode 派发（`tool/code-dispatch` 事件），其 turn/step 借自外层根调用——并附带每一次 write/edit 改动的 diff，同时并入会话 `bash` 调用写过的文件（heredoc、`>` 重定向、`tee`、`sed -i`，由宿主侧采集器在每次调用落定后 `fs.stat` 验证）；`read` 通过 `ctx.fs` 提供其中某个文件的当前文本内容（图片则返回浏览器可加载的 URL），以会话 cwd 为基准解析相对路径并按配置截断；`reveal` 在宿主文件管理器中打开某个文件的所在文件夹并选中该文件（"在文件夹中打开"手势）。该服务不持有任何会话状态、不写入任何东西——会话日志与文件系统始终是权威来源。

## 配置

```yaml
- id: file-preview
  name: '@khorsheed/dsh-file-preview'
  config:
    maxReadBytes: 524288
    maxFiles: 500
    captureBashWrites: true
```

`maxReadBytes` 限制单次 `read`（更大的文件直接返回 `too-large`，不读取）；`maxFiles` 限制 `list` 的折叠结果。两者都必须是正整数；默认值分别为 512 KiB 与 500。`captureBashWrites`（默认 `true`）开关 bash 写入采集器：开启时，服务监听每个会话的 `tool/call`（bash）+ `tool/result` 配对，从命令里提取高精度写入目标（`cat > path` heredoc、单 `>` 重定向、`tee` 非追加、`sed -i`），按宿主环境与会话 cwd 展开 `$VAR`/`~`/相对路径，且只记录文件系统里真实存在为文件的路径（`fs.stat`，宁缺毋滥）。采集结果存在按会话的内存登记表里，`session/created` 时重放会话自身历史重建——宿主重启后不丢；会话日志本身绝不被改动（官方 `Session.append` 无法给插件事件标 `ignorable`，而持久化读回会拒绝未知的非 ignorable 类型——见 `docs/upstream-seam-registry.md` 的 S2 条目）。bash 采集的文件没有 diff 历史；预览与普通条目一样通过 `read` 读当前内容。

## 服务契约

`ctx.filePreview`（wire 命名空间 `filePreview`）暴露三个生成的 Remote 方法：

- `list(agent)` — 对 `agent.session.events` 的纯折叠：`read`、`write`、`edit`（三者都用 `file_path` 参数键）工具的每条 `tool/call` 都贡献一个展示路径，这些工具的已完结 `tool/code-dispatch`（嵌套 Code Mode 调用）同样计入——失败的派发不记录，且因派发事件不带 turn/step，条目借用最外层根调用的位置。重复路径原地刷新其操作与位置，保持首次出现顺序。`write`/`edit` 的 `tool/result` 若携带 `diffs` 演示元数据，则把每次改动按事件序追加到条目的 `diffs`（各带 seq/turn/step），`lastDiff` 保留为最后一次改动，并在后续读取中全部保留。响应携带条目、最后扫描的 seq，以及是否触达 `maxFiles` 上限。折叠本身不访问文件系统；`captureBashWrites` 开启时，条目并入采集器验证过的 bash 写入路径（见配置）。
- `read(agent, path, signal)` — 以 `agent.session.header.cwd` 为基准解析 `path`，把文件的当前内容以 `kind: 'text'` 返回（超过 `maxReadBytes` 时截断并标记 `truncated`）；路径是图片且存在 web 宿主时返回 `kind: 'image'` 及浏览器可加载的 `url`；否则返回分类提示：`binary`（二进制扩展名或解码文本含 NUL 字节）、`missing`（文件不存在）、`too-large`（后端报告的大小超过上限）、`error`（解析/stat/解码失败，含消息）。二进制扩展名绝不读取。图片字节走专门的宿主路由（`/file-preview-image/<sessionId>/<path>`，仅当组合了可选的 `webServer` 与 `agents` 服务时注册），让浏览器原生加载而不撑大 RPC 通道；无 web 宿主时图片读取返回 `binary`。
- `reveal(agent, path, signal)` — 通过 `ctx.fs` 以 `agent.session.header.cwd` 为基准解析 `path`，然后在宿主文件管理器中打开该文件的所在文件夹并选中它，全程无 shell，走 `@deepseek-ai/dsh-native-command`：macOS `open -R`（Finder）、Windows `explorer /select,<path>`（Explorer）、WSL 先用 `wslpath` 转成 Windows 路径、桌面 Linux 依次尝试支持选中的文件管理器（`nautilus` / `dolphin` / `nemo` `--select`）。文件管理器选中文件时返回 `{ revealed: true }`；记录路径解析不到存在的目标时返回 `{ revealed: false, reason: 'missing' }`，没有可用的文件管理器时返回 `'select-failed'`——此时调用方改为打开父文件夹，手势总能落在可见处。原生 reveal 只把路径交给宿主 OS，服务不写入任何东西。

该服务是受信任的只读能力：它能读取 `ctx.fs` 允许会话访问的一切，因此组合它就等于授予对会话文件系统视图的预览权限——它不是安全边界。服务不产生任何会话事件，也不维护按会话的缓存。

## 分享

本包是纯宿主侧增量：它只注册一个 Remote 服务（由浏览器半经官方的 `ctx.remote.$mount` 通道挂载），不向其他包写入任何东西。浏览器半（`@khorsheed/dsh-client-ui-file-preview`）同样纯增量，只依赖官方扩展点。两个包都可独立分发，零改动组合进原版 dsh 核心。

## 兼容性

- npm 发布线(`@deepseek-ai/dsh@0.1.0-rc.7`):✅ 完整——运行时只依赖官方公开稳定面(slots、核心服务、核心事件、cordis 4.x、schemastery)。
- 源码线(deepseek-harness master):✅

## 已知限制与待办

- **列表是时间点折叠** —— 客户端通过重新调用 `list` 刷新；目前没有新文件推送通道。
- **不提供二进制预览内容** —— 非图片的二进制文件只返回 `kind: 'binary'` 及大小；内联渲染其内容留待后续。
