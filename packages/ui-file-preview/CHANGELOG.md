# 变更记录

## 未发布

- **方案 B 与产物面二期整体回退（仓主拍板 2026-09-24，同日落地同日否决）。** 恢复 0.1.5 的自绘产物页形态，双线同一份：page 型右栏 tab 以 extension 档认领 `dsh-resource://file/**` 可渲染后缀（压过官方 document tab 的 fallback 档——rc.1 的 tab-registry 保留 band 机制），文件树/mention/回合卡/产物行点击全部落自绘详情页（共享内容面板全 chrome + 内容/改动记录切换）；pdf/压缩包/二进制等 decline 后缀落回官方 document tab。撤回物：内容/改动记录两个 `documentPreviews` 渲染器注册与 `documentPreviews` 探测/延迟退役机制、FileContentBody/FileHistoryBody/file-artifacts 薄壳、共享内核的 headless 模式（prop/分支/CSS/spec 整体退役）。否决依据：嵌入方案的接缝成本（renderer loading 协议、extension 档接管语义、headless 布局耦合）与 UX 妥协（改动记录塞进渲染器下拉、复制钮浮动压搜索行）。**不在否决范围、予以保留**：turnTail 回合卡的 deliverables 遮蔽（list 槽臂同官方 cell id 注册 priority -1 空体）与 FilePreviewTab 读 `navigation.params.path` 的 `'path' in` 收窄修复。minHost 不动（`0.1.5-rc.1`）：包内不再有 rc.1 专有 API。

## 未发布

- 内容搜索不再劫持视图：命中经 CSS Custom Highlight API 画在渲染后的正文上（`::highlight()` 外包 `:global()`，否则 lightningcss 会像类名一样改写标识符导致静默不上色）；只有渲染态确实看不见的查询才回落到原始命中行视图，代码视图搜索时因此保留语法配色；HTML 沙箱预览与不支持该 API 的宿主行为不变。
- 注册任何 UI 前探测宿主的零会话 `capabilities()` Remote；client-only 组合不再留下错误卡、renderer、locale 或空 tab。
- 导出 `installFilePreviewSurfaces(ctx, remote)`，让握手、安装与卸载边界可直接测试。

## 未发布

- 注册任何 UI 前探测宿主的零会话 `capabilities()` Remote；client-only 组合不再留下错误卡、renderer、locale 或空 tab。
- 导出 `installFilePreviewSurfaces(ctx, remote)`，让握手、安装与卸载边界可直接测试。

## 0.3.0（2026-09-11）

迁入官方 0.1.5 右栏体系，退役绕行缝 S1。

- **BREAKING**：minHost 前移至 `0.1.5-rc.1`；宿主 `0.1.2-rc.1` ~ `0.1.4.x` 的用户请停留在 0.2.x 线
- 「产物」从 `conversation.view` tab 变为右栏 page-type tab（向导页进入）：列表 + 行内导航到详情页（面包屑头 + 复制路径/在文件夹打开/在 IDE 打开 +「内容 / 改动记录」切换；内容预览栈从旧抽屉恢复：Markdown/JSON/CSV/HTML 沙箱/代码高亮 + 内容搜索）
- 正文 mention 点击走官方 document tab 快速预览；「改动记录」同时注册为官方预览页的可切换渲染器（工具栏下拉）
- 改动记录（逐次 write/edit diff 步进，本插件独有，保留自绘）成为官方预览页的可切换渲染器：工具栏下拉选「改动记录」（`ctx.documentPreviews` + keyed `sidebar.right.tab.document`，`priority: 'builtin'` 不抢官方默认渲染）
- 退役：`shell.overlay` 预览抽屉、正文 mention 的捕获阶段 DOM 拦截、turnTail 的 `priority: -1` 抢占、自绘文档预览（Markdown/JSON/CSV/HTML 沙箱渲染）
- 回合变更卡片保留（数据含 bash 捕获，比官方产物行全），改默认优先级：官方产物行先选举，本卡片只出现在官方数据覆盖不到的回合；点击工作区内文件走官方 `openFile` 路由，工作区外产物打开右栏「产物」页并选中其改动记录
- 边界：工作区外的 bash 产物造不出 `dsh-resource://file/...` 地址（官方 `file` 资源限定工作区）——列表行带提示标记，但我们自己的详情页不受此限：内容与改动记录照常可看
- 行动作恢复（旧抽屉语义，详情页头部）：复制路径（始终）/ 在文件夹中打开（宿主半 `reveal` 选中文件，回退官方 open-in-app 路由开父目录）/ 在 IDE 打开（split 图标按钮：主按钮首选 IDE、chevron 下拉列出全部探测到的 IDE，下拉右对齐不被面板右缘裁切；官方 open 路由只收目录，文件级走宿主半新方法 `openExternal`——macOS `open -a`，经 `/open-in-app/apps` 探测，无对应应用或非 macOS 时按钮隐藏）
- 打磨：详情页面包屑改分段「 / 」样式（目录段弱化、文件名加粗、长段各自省略号）；改动记录与当前内容统一吃 `--dsh-content-font-size` 系令牌（官方 `--dsw-font-markdown-code-block` 固定 11px 不随设置，作用域内重绑到 `--dsh-content-font-size-secondary`）；详情头部面包屑段间加隙；「改动记录」tab 按需出现（fold 无 diff 记录时不显示）
- mention 打开直落详情页：就地包装官方 `chatFileMentions`（保留官方认领逻辑，open 改走规范化文件地址、label 修为「在侧边栏打开」）；登记为缝 S1 的尾巴
- 同一文件单一 tab：mention 与回合卡片统一走 `openResource('dsh-resource://file/session/<id>/<path>')` 规范化地址（mention 原来开 page 地址、卡片开文件地址，同一文件出现两个详情 tab）；回合卡片不再区分工作区内外——我们的认领覆盖 session 作用域内全部可渲染地址（工作区外绝对路径也在其内，详情页经 Remote read 正常渲染），重复点击聚焦已有 tab
- 产物打开入口统一：tab 类型升级为地址认领型（`patterns: ['dsh-resource://file/**']` + `canOpen` 纯静态：session 作用域 + 可渲染后缀；extension 档压过官方 fallback 档）。mention / 官方产物卡片 / 文件树的打开全部落我们的详情页；渲染不了的类型（pdf 等）回落官方 document tab。早期版本曾按 fold 记录过滤——冷缓存窗口导致「有时官方有时我们」的竞态，已去除
- 回合卡片升级为产物表格并取代官方 deliverables 行（用户决策 2026-09-11）：紧凑表格（图标+文件名+目录+增删行数），>3 个产物折叠为「N 个产物」可展开摘要行；`priority: -1` 抢占恢复——官方行永不挂载（其大卡不折叠、间距观感差）。选举语义记录：链为升序先选，官方默认 0

## 0.2.0（2026-09-10）

适配宿主 0.1.2 线。

- **BREAKING**：minHost 前移至 `0.1.2-rc.1`；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户请停留在 0.1.x 线（末版 `0.1.0`）
- external-open 按钮（打开目录 / 在 IDE 打开）在 0.1.2 上隐藏：host description 快照不再携带 `canOpenPath`（该能力已改为 RPC 探测），loopback 闸门无法确认；恢复是 follow-up，官方 seam 为 `remote.session.canOpenWorkspacePath` RPC。预览与折叠主体不受影响
- 导入面迁移：client bundle 不再引用宿主已删除的 `dsh-client-runtime`，ui-primitives 组件补齐强制 labels

## 0.1.0（2026-08-22）

首个公开发布。

- 「产物」tab：列出会话写入或编辑过的每个文件，按最近活动倒序，可切换到全部文件
- 文档形态预览：Markdown 渲染为文档，JSON/CSV 呈现为检查树/表格，HTML 提供源码 ⇄ 沙箱渲染切换，图片内联
- 改动记录：步进查看每一次 write/edit 的 diff，每条带所属轮次与步骤
- 回合变更卡片：每个已完成回合末尾列出本回合修改的文件与行数增减
- 就地抽屉预览，支持内容搜索与「复制路径」，部署可对接原生桌面时另有「在文件夹中打开」和「在 IDE 打开」
