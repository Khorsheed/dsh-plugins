# @khorsheed/dsh-local-files

[English](README.en.md) | 中文

工作区之外的本地目录，也能在右栏随手翻——懒加载文件树配结构化预览，git 无关，默认落在当前会话的工作区，但不锁死在那里。

想看一眼工作区旁边的素材目录、仓库外的一份数据文件，以前得切去系统文件管理器。这个插件在右栏注册一个**文件列表**页型 tab（guide 页「文件列表」卡片进入）：左侧是按层懒加载的文件树，右侧详情区把 HTML/Markdown/JSON/CSV 渲染成结构化视图、图片直接内联。它浏览任意绝对本地路径——未跟踪的、被 ignore 的、仓库外的一视同仁；数据面走自带的 Typert Remote，和 worktrees 插件的 git 徽标互不相识：那边只做 git 状态，这边只做纯粹的本地文件浏览。（细分：本插件是「任意本地目录浏览」，file-preview 是「当前会话产物」——语义不同，故为两个独立包。）

## 特性

- **文件列表 tab**——右栏 page-type tab，guide 页「文件列表」卡片进入。注册以 extension 档接管官方 `files` 页型（注册表内建的 kind 级遮蔽）：guide 页只出现一张文件卡片，官方「工作区文件」卡片在本插件卸载时自动恢复，绝不双卡并存。
- **左树右预览**——文件树按层懒加载、隐藏文件一键显隐、面板可拖拽调宽；详情区结构化渲染 HTML/Markdown/JSON/CSV、内联图片；标题行「重新加载」手势重读当前文件——磁盘上的改动不必重选即得，重读失败保留旧内容并经既有错误槽呈现。
- **默认根 = 本会话工作区**——与官方文件树同一数据源（会话行 `cwd` 响应式读取，行未加载时晚到即补）；手动切换的目录按会话记住（localStorage `dsh-local-files-root:<sessionId>`），重开 tab / 重载页面恢复；工具行的「退回原始工作区」一键回到当前会话工作区根（已在工作区时隐藏）。
- **面包屑 + 动作行**——面包屑逐级导航；动作按钮为「选择工作区」（系统目录选择器）、「退回原始工作区」、「在文件夹中显示」（宿主 open-in-app 解析出文件管理器时显示）、「刷新文件」。
- **git 无关**——浏览的是任意绝对本地路径（含未跟踪、被 ignore、仓库外的文件），不做 repo 判定。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-local-files
```

重启 web 实例后生效；无需任何配置。卸载即精确还原之前的组合——官方「工作区文件」卡片随之恢复。

```sh
dsh plugin --profile web remove @khorsheed/dsh-local-files
```

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——右栏页型 tab（`sidebar.right.pane.tab` 座位与 kind 级遮蔽注册表）与 open-in-app 路由在该线均在，`minHost` 钉在 `0.1.5-rc.1`。`0.1.2`–`0.1.4` 宿主没有右栏，本插件在那里没有任何浏览器表面（首个公开发布即要求 0.1.5 起，旧宿主请勿安装）。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.7-rc.2）——rc 线的图标改名（`Icon*Outline14/16` → `Icon*OutlineMedium`）与插件清单展示元数据（`locale/*.json`）均已跟进；本包构建与测试在 0.1.7-rc.2 源码树（`DSH_HARNESS`）下通过。
- **Web 表面**：右栏 tab 是浏览器表面；headless profile 没有浏览器消费者，本插件在那里零贡献（host 半的 Remote 照常注册）。
- **手势探测降级**：「在文件夹中显示 / 在 IDE 中打开」走官方 open-in-app——浏览器每页探测一次 `GET /open-in-app/apps`，宿主解析出对应应用（文件管理器 / 编辑器）才显示该手势，探测失败保持隐藏；「选择工作区」探测宿主的 directoryPicker Remote，缺席时按取消处理。两条路径都静默降级，不影响启动。

## 已知限制

- **只读浏览器**——没有新建、重命名、删除、编辑手势；浏览与预览是唯一目的。
- **大文件有窗口上限**——文本一次最多读 2 MB（超出部分显示截断标记，界面暂无「继续加载」手势）；图片超过 2 MB 不内联（显示大小与占位）；二进制文件按 NUL/控制字节比例判定，显示非文本占位。
- **「打开」手势只收目录**——官方 open 路由不接受文件路径，文件上的「在文件夹中显示 / 在 IDE 中打开」打开的是其所在目录。
- **浏览范围 = 宿主进程用户可读的整台机器**——路径校验只做形状检查（必须绝对路径、拒绝 `..` 穿越），不把浏览圈定在某个子树内；这与官方文件预览同一信任模型（自己的机器），共享/多租户部署请知悉。
- **搜索高亮有绘制上限**——预览内搜索经 CSS Custom Highlight API 画在渲染后的视图上，最多绘制 2000 处命中，超出不再标色；HTML 沙箱预览与不支持该 API 的宿主不标色。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**数据面。** Host 半 `ctx.provide('localFiles')` 一个无状态服务核心，再由 namespace `localFiles` 的 Typert Remote 薄适配出两个 verb：`listDirectory` / `readFile`（纯 JSON 参数、无 caller lookup——路径本来就是绝对的，任何会话或全局帧都可调用）。客户端经官方 `ctx.remote.$mount` 通道自行挂载。

**窗口化读取。** 文本读以字节窗口为界（`MAX_CONTENT_BYTES = 2 MB`，多读 1 字节判定截断），返回的 `nextOffset` 标记续读起点；图片全有或全无——stat 超限直接 `too-large`，否则整图以 base64 data URL 返回；二进制按解码后 NUL/控制字节比例 > 2% 判定。路径先过 `assertSafeLocalPath` 形状校验（绝对、无 `..`）再 `realpath` 规范化。

**页型接管。** 注册表给每个 builtin kind 只留一个 extension 名额并使其生效——claims、guide 页、body/title 座位查找全部跟随生效定义，被遮蔽的 builtin 在 extension 注销时恢复。本实现的 `id` 保持自己的（`@khorsheed/dsh-local-files`）：id 冲突是硬失败，kind 才是设计好的接管通道。

**默认根与记忆。** 会话行 `cwd` 响应式读取，行晚到即补——绝不覆盖已记住或已手选的根；手动切换写 localStorage（`dsh-local-files-root:<sessionId>`）并经一张外部可读的 store 广播，按会话隔离。

**探测而非注入。** 目录选择器 Remote 用 `ctx.get` 探测而非 `inject`——后者会让整个插件在没有选择器的组合里永远 pending；open-in-app 每页探测一次应用清单，两个外部打开手势按解析结果显示或隐藏。

**预览层复用。** 详情区是 `@khorsheed/dsh-client-ui-content-preview` 的共享内容面板（workspace 源码在构建期打进 client bundle，非运行时依赖）：Markdown / JSON 树 / CSV 表 / 代码视图各就各位；HTML 默认静态渲染（脚本不执行），含脚本文档给出提示，确认后才在沙箱内运行。

**身份三角。** cordis 行 id `local-files`、`clientBundle('@khorsheed/dsh-local-files')`、`src/invariant.ts` 的 `PACKAGE_NAME` 三处同名。

**导出。** `/` 导出 host 半（`LocalFilesService` 核心与 `LocalFilesRemoteService`）；`/client` 导出插件本体（`apply`/`inject`）与 `WorkspaceView`、`LOCAL_FILES_KIND`/`LOCAL_FILES_TAB_ID`；`/types` 提供线上载荷类型；`/invariant` 提供部署自检件。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/local-files`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
