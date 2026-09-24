# @khorsheed/dsh-client-ui-file-preview

[English](README.en.md) | 中文

agent 写过、改过的文件，收进右栏一个「产物」页：文件清单 + 每一次改动的 diff 步进。

agent 干了半天活，到底动了哪些文件、改成了什么样？装了这个插件，右栏向导页会多出「会话产物」入口：这个会话碰过的文件按最近活动倒序列出；点一个进入详情页——头部与预览栈由**共享内容面板** `@khorsheed/dsh-client-ui-content-preview` 渲染（标题行：文件名 + 语言标签 + 复制路径 / 在文件夹打开 / 在 IDE 打开，多 IDE 时是带 app 菜单的分体控件；路径行：路径 + 内容/改动记录与渲染/源码等视图控件；搜索行：内容搜索），内容侧是文档形态（Markdown 渲染成文档、JSON 检查树、CSV 表格、HTML 沙箱分级渲染、代码高亮），改动记录逐次步进回看每一次 write/edit 的 diff。所有打开入口——正文 mention、官方产物行、文件树、回合卡片——对可渲染的会话文件都落到我们的详情页（tab 类型以 `dsh-resource://file/**` + 可渲染后缀认领，extension 档压过官方 document tab 的 fallback 档，纯静态判定无冷启动窗口；pdf、压缩包等我们渲染不了的类型自动回落官方 document tab）。每个回合结束，对话里出现一张小卡片，汇总这一轮改了哪几个文件、各增删了多少行——在 list 语义的宿主上（0.1.6-alpha.2 起）这是回合区唯一的产物卡（官方 present 卡与内存态 changes 卡被 slot 遮蔽机制压下，见「实现原理」）。数据由配套的宿主半 `@khorsheed/dsh-file-preview` 提供（含官方数据覆盖不到的 bash 写入捕获），两边一起装才有界面可看；宿主半不在时全部 UI 面缺席——不留错误卡或空 tab。

## 特性

- **右栏「产物」页（双线一致）**——page-type 右栏 tab（向导页进入）兼认领方：会话写入或编辑过的每个文件按最近活动倒序、可搜索；点行进入详情页。0.1.5 与 0.1.7-rc.1 同一份形态（方案 B 的官方面嵌入已于 2026-09-24 回退）。
- **详情页**——面包屑路径头 + 行动作（复制路径恒定可用；宿主探测到对应应用时另有「在文件夹中打开」= 文件管理器选中该文件、「在 IDE 打开」= 文件级精确打开，split button 下拉可选探测到的任一 IDE）；标题行「重新加载」手势重读当前文件的内容（磁盘上的新内容一键进面板，重读期间旧内容保持显示，失败保留旧内容并走既有错误槽）；「内容 / 改动记录」切换——内容是文档形态预览（Markdown/JSON/CSV/HTML 沙箱分级/代码高亮 + 内容搜索），改动记录逐次步进每一次 write/edit 的 diff（官方至今仍无对应维度：workspace-changes 内存态、git-only、宿主重启即失——此维度长期自留，**跟踪上游**）。
- **工作区外产物同等待遇**——bash 写到工作区外的文件在我们自己的详情页里内容和改动记录都照常可看（走本插件 Remote，官方工作区读覆盖不到）。
- **回合变更卡片（双线）**——每个已完成回合末尾可收起的「N 个产物」卡片（含 bash 捕获，比官方产物行数据全），逐文件列出行数增减；点击走官方打开路由（可渲染地址由本页认领）。list 槽宿主上同槽官方 deliverables 条目（present 卡 + 内存态 changes 卡）被一等 slot 遮蔽压下——回合区只留这张持久全量卡。

## 安装

界面与数据分成两个包，都要装：

```sh
dsh plugin --profile web add @khorsheed/dsh-file-preview            # 宿主半：折叠文件清单、读内容
dsh plugin --profile web add @khorsheed/dsh-client-ui-file-preview  # 本包：界面
```

然后重启 web 实例。卸载本包（宿主半可留可卸）：

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-ui-file-preview
```

## Compatibility

| Host 行 | 结论 |
| --- | --- |
| deepseek-harness master（`0.1.7-rc.1`） | ✅ 完整——与 0.1.5 同一形态：自建产物页 extension 档认领可渲染地址（rc.1 的 tab-registry 保留 band 机制）；turnTail list 槽臂附带官方 deliverables 遮蔽 |
| npm release（`>= 0.1.5-rc.1`） | ✅ 完整（`verifiedHost: 0.1.5-rc.1`）——同一形态；turnTail 为 chain 槽时按探测回落 select + priority -1 抢占臂 |
| npm release（`<= 0.1.4.x`） | ❌ 不可用——右栏 tab 体系（`ctx.sidebarRightTabs` / `openResource`）随 0.1.5 落地；旧宿主请停留在旧发布线 |

**版本线对照**：0.3.0 起要求宿主 `0.1.5-rc.1` 及以后；宿主 `0.1.2-rc.1` ~ `0.1.4.x` 的用户请停留在 0.2.x 发布线，宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 发布线（末版 `0.1.0`）。minHost 不动：回退后包内不再有 rc.1 专有 API（turnTail 的 list/chain 双臂本就有 0.1.5 回退）。

## 已知限制

- **工作区外产物不进官方路由**——bash 写到会话工作区之外的文件造不出 `dsh-resource://file/...` 地址（官方 `file` 资源限定工作区内），列表行带提示标记；但我们自己的详情页不受此限——内容与改动记录照常可看。
- **仅当前会话**——只显示当前所选会话的文件，不是任意文件浏览器。
- **只读**——预览与改动记录永不修改文件；文件变更仍归会话所有。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

- `src/client/index.ts` —— apply：挂载 `filePreview` Remote 并执行零会话 `capabilities()` 握手；成功后由 `installFilePreviewSurfaces` 注册所有 UI 面并统一卸载；turnTail 的 list 臂同时注册官方 deliverables 条目的遮蔽体
- `src/client/definition.tsx` —— page-type tab 的注册表定义（guide 入口 + `dsh-resource://file/**` 可渲染后缀认领）与认领后缀清单
- `src/client/FilePreviewTab.tsx` —— 右栏「产物」页（列表 + 详情视图）
- `src/client/preview.ts` —— 适配层：`filePreview` wire kind → 内核 `PreviewRead`、字典适配（详情页的头部与预览栈来自 `@khorsheed/dsh-client-ui-content-preview`，本插件的私有渲染副本已删除）
- `src/client/DiffHistory.tsx` —— 逐次 write/edit diff 步进（本插件独有）
- `src/client/mentions-wrap.ts` —— mention 打开方向统一进右栏的就地包装（缝 S1 尾巴）
- `src/client/open-in-app.ts` —— 官方 open-in-app 探测（行动作可见性）
- `src/client/TurnFileRow.tsx` —— 每回合的「N 个产物」卡片

纯增量插件：注册一个右栏 tab 类型（`ctx.sidebarRightTabs` + keyed `sidebar.right.pane.tab` seat）与一个回合文件行（`conversation.chat.turnTail`——0.1.6-alpha.2 起该槽为 list 语义，本行另注册一条同官方 deliverables cell id、priority -1 的空体遮蔽官方 present/changes 卡——slot 系统一等遮蔽：同 cell 异优先级共存、最低者渲染，官方条目仍在册故其声明的 `deliverables.file.actions` 子槽不塌；0.1.5 宿主上该槽仍是 chain 选举，注册按探测回落为旧的 select + `priority: -1` 抢占形），并通过 `ctx.remote.$mount` 自挂载 `filePreview` Remote——原版 dsh 核心零改动即可运行。该命名空间不声明为 inject（自挂载会让加载器死锁）；挂载被 await 后用 `ctx.get('remote.filePreview')` 读回，并先执行零会话 `capabilities()`；只有 `{ protocolVersion: 1 }` 成功返回才安装这些 UI 面，宿主缺席时全部缺席。文件列表由 `@khorsheed/dsh-file-preview` 在宿主侧折叠（含嵌套 Code Mode 派发与 bash 写入捕获）。回合卡片经按会话的客户端缓存读同一个宿主 `filePreview.turnFiles` RPC——卡片与 tab 同一事实源。

0.1.5-rc.1 迁移退役了四处绕行（上游缝 S1 已落地）：`conversation.view` 的「产物」tab、`shell.overlay` 预览抽屉、正文 mention 的捕获阶段 DOM 拦截、turnTail 的 `priority: -1` 抢占——产物行 / 正文 mention / 工具结果行的打开入口官方已统一收敛到 `ctx.sidebarRight.openResource()`。方案 B（2026-09-24 落地、同日被仓主否决回退）：内容面注册进官方 `documentPreviews` 面做官方 document tab 默认渲染器 + 二期 headless 嵌入——接缝成本（renderer loading 协议、extension 档接管语义、headless 布局耦合）与 UX 妥协（改动记录塞进渲染器下拉、复制钮浮动压搜索行）不成立，自绘产物页（地址认领形态）双线恢复；turnTail 遮蔽不在否决范围，保留。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/ui-file-preview`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
