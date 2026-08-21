# @khorsheed/dsh-file-preview

[English](README.md) | 中文

dsh 文件预览界面背后的只读宿主服务:把一次会话的日志折叠成其 `read`/`write`/`edit` 工具调用触碰过的文件清单——每一次 write/edit 改动的 diff 都在——并入会话 `bash` 调用写过的文件,并为预览提供其中任一文件的当前内容。与配套客户端(`@khorsheed/dsh-client-ui-file-preview`)成对安装后,web GUI 便获得「产物」tab:内联预览、逐改动的 diff 历史、"在文件夹中打开"手势。该服务不持有任何会话状态、不写入任何东西——会话日志与文件系统始终是权威来源。

<img src="docs/screenshots/06-file-preview.png" width="480" alt="配套客户端的文件预览:文件列表与内联 markdown 预览">

## 特性

- **会话文件清单**——会话 `read`/`write`/`edit` 调用触碰过的每个文件(含嵌套 Code Mode 派发),每次 write/edit 改动附 diff;重复路径原地刷新,保持首次出现顺序。
- **内容读取**——文件当前文本,按配置截断并标记;web 宿主上图片返回浏览器可加载的 URL;二进制、不存在、超限文件返回分类提示而非内容。
- **bash 写入采集**——经 `bash` 写入的文件(heredoc、`>` 重定向、`tee`、`sed -i`)并入清单,每条经 `fs.stat` 对照真实文件系统验证,宿主重启后重放会话自身历史重建。
- **在文件夹中打开**——在宿主文件管理器中打开文件所在文件夹并选中该文件:macOS Finder、Windows Explorer、WSL、桌面 Linux,全程无 shell,走官方 native-command 服务。
- **只读设计**——无会话状态、无写入、不改文件系统;宿主重启不丢任何东西。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview
```

本包只是宿主半;可见界面(「产物」tab、预览抽屉、回合变更卡片)在配套客户端里——建议成对安装:

```sh
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview
```

卸载即精确还原之前的组合;若客户端半仍装着,其界面降级为空态而非报错:

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

`maxReadBytes` 限制单次 `read`(更大的文件直接返回 `too-large`,不读取);`maxFiles` 限制 `list` 的折叠结果。两者都必须是正整数;默认值分别为 512 KiB 与 500。`captureBashWrites`(默认 `true`)开关 bash 写入采集器。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.1-rc.1`):✅ 完整——rc.8→0.1.1-rc.1 API 审计(2026-08-21)确认本插件消费的所有面无变化或纯增量(ProjectionDefinition 重构、cacheHitPercent 返回值变更、credentials/updated 事件改名均不涉及本包),无需改动源码。
- 源码线(deepseek-harness master):✅

## 已知限制

- **列表是时间点折叠**——客户端通过重新调用 `list` 刷新;目前没有新文件推送通道。
- **不提供二进制预览内容**——非图片的二进制文件只返回 `kind: 'binary'` 及大小;内联渲染其内容留待后续。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

`ctx.filePreview`(wire 命名空间 `filePreview`)暴露四个生成的 Remote 方法:

- `list(agent)` —— 对 `agent.session.events` 的纯折叠:`read`、`write`、`edit`(三者都用 `file_path` 参数键)工具的每条 `tool/call` 都贡献一个展示路径,这些工具的已完结 `tool/code-dispatch`(嵌套 Code Mode 调用)同样计入——失败的派发不记录,且因派发事件不带 turn/step,条目借用最外层根调用的位置。`write`/`edit` 的 `tool/result` 若携带 `diffs` 演示元数据,则把每次改动按事件序追加到条目的 `diffs`(各带 seq/turn/step),`lastDiff` 保留为最后一次改动,并在后续读取中全部保留。响应携带条目、最后扫描的 seq,以及是否触达 `maxFiles` 上限。折叠本身不访问文件系统;`captureBashWrites` 开启时,条目并入采集器验证过的 bash 写入路径。
- `read(agent, path, signal)` —— 以 `agent.session.header.cwd` 为基准解析 `path`,把文件的当前内容以 `kind: 'text'` 返回(超过 `maxReadBytes` 时截断并标记 `truncated`);路径是图片且存在 web 宿主时返回 `kind: 'image'` 及浏览器可加载的 `url`;否则返回分类提示:`binary`(二进制扩展名或解码文本含 NUL 字节)、`missing`(文件不存在)、`too-large`(后端报告的大小超过上限)、`error`(解析/stat/解码失败,含消息)。二进制扩展名绝不读取。图片字节走专门的宿主路由(`/file-preview-image/<sessionId>/<path>`,仅当组合了可选的 `webServer` 与 `agents` 服务时注册),让浏览器原生加载而不撑大 RPC 通道;无 web 宿主时图片读取返回 `binary`。
- `reveal(agent, path, signal)` —— 通过 `ctx.fs` 以 `agent.session.header.cwd` 为基准解析 `path`,然后在宿主文件管理器中打开该文件的所在文件夹并选中它,全程无 shell,走 `@deepseek-ai/dsh-native-command`:macOS `open -R`(Finder)、Windows `explorer /select,<path>`(Explorer)、WSL 先用 `wslpath` 转成 Windows 路径、桌面 Linux 依次尝试支持选中的文件管理器(`nautilus` / `dolphin` / `nemo` `--select`)。文件管理器选中文件时返回 `{ revealed: true }`;记录路径解析不到存在的目标时返回 `{ revealed: false, reason: 'missing' }`,没有可用的文件管理器时返回 `'select-failed'`——此时调用方改为打开父文件夹,手势总能落在可见处。原生 reveal 只把路径交给宿主 OS,服务不写入任何东西。
- `turnFiles(agent)` —— 每个回合的文件变更,回合卡片的单一事实源,与 `list` 同源(write/edit 调用、借用根调用 turn 的 Code Mode 派发、result diff meta 的 render-intent 路径——这些也会登记进 `list`——以及按各自 turn 并入的 bash 捕获)。与 `list` 不同,路径**不**去重到最后一次:同一文件在两个回合都改过,两个回合的分组里都有它——每张卡片精确列出该回合改了什么。逐回合行数增减由 result diff 求和(新建/覆盖时 removed 未知)。按回合折叠按会话缓存、由日志水位线失效,重复卡片拉取不会重新折叠;响应携带水位线供客户端自缓存。

bash 写入采集器:`captureBashWrites` 开启时,服务监听每个会话的 `tool/call`(bash)+ `tool/result` 配对,从命令里提取高精度写入目标(`cat > path` heredoc、单 `>` 重定向、`tee` 非追加、`sed -i`),按宿主环境与会话 cwd 展开 `$VAR`/`~`/相对路径,且只记录文件系统里真实存在为文件的路径(`fs.stat`,宁缺毋滥)。采集结果存在按会话的内存登记表里,`session/created` 时重放会话自身历史重建——宿主重启后不丢;会话日志本身绝不被改动(官方 `Session.append` 无法给插件事件标 `ignorable`,而持久化读回会拒绝未知的非 ignorable 类型——见 `docs/upstream-seam-registry.md` 的 S2 条目)。bash 采集的文件没有 diff 历史;预览与普通条目一样通过 `read` 读当前内容。

信任与状态:该服务是受信任的只读能力——它能读取 `ctx.fs` 允许会话访问的一切,因此组合它就等于授予对会话文件系统视图的预览权限;它不是安全边界。服务不产生任何会话事件;它唯一持有的按会话状态是按回合折叠缓存(水位线失效)与 bash 采集器的已验证写入登记表。

分享:本包是纯宿主侧增量——它只注册一个 Remote 服务(由浏览器半经官方的 `ctx.remote.$mount` 通道挂载),不向其他包写入任何东西。浏览器半(`@khorsheed/dsh-client-ui-file-preview`)同样纯增量,只依赖官方扩展点。两个包都可独立分发,零改动组合进原版 dsh 核心。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/file-preview`)。问题与贡献请移步该仓库。
