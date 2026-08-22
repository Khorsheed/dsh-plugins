# @khorsheed/dsh-file-preview

[English](README.en.md) | 中文

dsh 文件预览界面的宿主服务:列出会话工具调用触碰过的每个文件——附每次 write/edit 改动的 diff——并提供任一文件的当前内容用于预览。与 `@khorsheed/dsh-client-ui-file-preview` 成对安装,web GUI 即获得「产物」tab:内联预览与"在文件夹中打开"。

<img src="../../docs/screenshots/file-preview1.png" width="480" alt="配套客户端的文件预览:文件列表与内联 markdown 预览">

<img src="../../docs/screenshots/file-preview2.png" width="480" alt="每个产物的改动记录:逐轮 diff 可翻页回看">

<img src="../../docs/screenshots/file-preview3.png" width="480" alt="「产物」tab:会话写过的全部文件一览">

## 特性

- **会话文件清单**——会话 `read`/`write`/`edit` 调用触碰过的每个文件,每次 write/edit 改动附 diff。
- **内容读取**——文件当前文本,超限截断并标记;web 宿主上图片返回浏览器可加载的 URL;二进制、不存在、超限文件返回分类提示。
- **bash 写入采集**——经 `bash` 写入的文件(heredoc、重定向、`tee`、`sed -i`)并入清单,经 stat 验证,宿主重启后重建。
- **在文件夹中打开**——在宿主文件管理器中打开所在文件夹并选中文件,支持 macOS、Windows、WSL、桌面 Linux。
- **只读设计**——无会话状态、无写入;宿主重启不丢任何东西。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview
```

仅宿主半——可见界面(「产物」tab、预览抽屉、回合变更卡片)在配套客户端里:

```sh
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview
```

卸载;残留的客户端半降级为空态而非报错:

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

`maxReadBytes` 限制单次 `read`(超限返回 `too-large`),`maxFiles` 限制 `list` 折叠结果——均为正整数,默认 512 KiB 与 500——`captureBashWrites`(默认 `true`)开关 bash 写入采集器。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.1-rc.1`):✅ 完整——rc.8→0.1.1-rc.1 API 审计(2026-08-21)确认本插件消费的所有面无变化或纯增量(ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包),无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- **列表是时间点折叠**——没有推送通道;客户端通过重新调用 `list` 刷新。
- **不提供二进制预览内容**——非图片二进制文件只返回 `kind: 'binary'` 及大小。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

`ctx.filePreview`(wire 命名空间 `filePreview`)暴露四个生成的 Remote 方法:

- `list(agent)`——对 `agent.session.events` 的纯折叠:`read`/`write`/`edit` 的 `tool/call` 贡献展示路径,这些工具的已完结嵌套 Code Mode `tool/code-dispatch` 同样计入(失败的派发不记录;条目借用根调用的 turn/step)。携带 `diffs` 元数据的 `write`/`edit` `tool/result` 把每次改动按事件序追加进条目,`lastDiff` 保留为最后一次。响应携带条目、最后扫描的 seq,以及是否触达 `maxFiles`。折叠本身不访问文件系统;`captureBashWrites` 开启时并入采集器验证过的 bash 写入路径。
- `read(agent, path, signal)`——以会话 cwd 为基准解析 `path`,返回 `kind: 'text'`(超过 `maxReadBytes` 截断并标记 `truncated`);web 宿主上图片返回 `kind: 'image'` 及浏览器可加载 URL——字节走专门的 `/file-preview-image/<sessionId>/<path>` 路由,仅当组合了可选的 `webServer` 与 `agents` 服务时注册;无 web 宿主返回 `binary`——否则返回分类提示:`binary`(二进制扩展名或 NUL 字节;绝不读取)、`missing`、`too-large`、`error`(含消息)。
- `reveal(agent, path, signal)`——在宿主文件管理器中打开文件所在文件夹并选中它,全程无 shell,走 `@deepseek-ai/dsh-native-command`:macOS `open -R`、Windows `explorer /select,<path>`、WSL 经 `wslpath`、桌面 Linux 依次尝试 `nautilus`/`dolphin`/`nemo --select`。选中返回 `{ revealed: true }`,否则 `false` 及 `reason: 'missing'`(目标不存在)或 `'select-failed'`(无可用文件管理器——调用方改开父文件夹,手势总能落在可见处)。不写入任何东西。
- `turnFiles(agent)`——每个回合的文件变更,回合卡片与 `list` 同源但**不**去重:同一文件在两个回合改过,两个分组都有它——每张卡片精确列出该回合改了什么。行数增减由 result diff 求和;折叠按会话缓存、由日志水位线失效,响应携带水位线供客户端自缓存。

bash 写入采集器:监听每个会话的 bash `tool/call`/`tool/result` 配对,提取高精度写入目标(`cat > path` heredoc、单 `>` 重定向、`tee` 非追加、`sed -i`),按宿主环境与会话 cwd 展开 `$VAR`/`~`/相对路径,只记录 `fs.stat` 确认为文件的路径(宁缺毋滥)。采集结果存于按会话的内存登记表,`session/created` 时重放会话自身历史重建——宿主重启后不丢;会话日志本身绝不被改动(官方 `Session.append` 无法给插件事件标 `ignorable`——见 `docs/upstream-seam-registry.md` 的 S2 条目)。bash 采集的文件没有 diff 历史;预览与普通条目一样通过 `read` 读当前内容。

信任与状态:受信任的只读能力——能读取 `ctx.fs` 允许会话访问的一切,组合它即授予对会话文件系统视图的预览权限;它不是安全边界。不产生会话事件;仅有的按会话状态是回合折叠缓存与 bash 采集器的已验证写入登记表。

分享:纯宿主侧增量——一个 Remote 服务,由浏览器半经官方的 `ctx.remote.$mount` 通道挂载。浏览器半(`@khorsheed/dsh-client-ui-file-preview`)同样纯增量;两个包独立分发,零改动组合进原版 dsh 核心。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/file-preview`)。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
