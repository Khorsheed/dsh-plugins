# 变更记录

## 0.3.0（2026-09-10）

迁入官方 0.1.5 右栏体系，退役绕行缝 S1。

- **BREAKING**：minHost 前移至 `0.1.5-rc.1`；宿主 `0.1.2-rc.1` ~ `0.1.4.x` 的用户请停留在 0.2.x 线
- 「产物」从 `conversation.view` tab 变为右栏 page-type tab（向导页进入）：列表 + 行内导航到详情页（面包屑头 + 复制路径/在文件夹打开/在 IDE 打开 +「内容 / 改动记录」切换；内容预览栈从旧抽屉恢复：Markdown/JSON/CSV/HTML 沙箱/代码高亮 + 内容搜索）
- 正文 mention 点击走官方 document tab 快速预览；「改动记录」同时注册为官方预览页的可切换渲染器（工具栏下拉）
- 改动记录（逐次 write/edit diff 步进，本插件独有，保留自绘）成为官方预览页的可切换渲染器：工具栏下拉选「改动记录」（`ctx.documentPreviews` + keyed `sidebar.right.tab.document`，`priority: 'builtin'` 不抢官方默认渲染）
- 退役：`shell.overlay` 预览抽屉、正文 mention 的捕获阶段 DOM 拦截、turnTail 的 `priority: -1` 抢占、自绘文档预览（Markdown/JSON/CSV/HTML 沙箱渲染）
- 回合变更卡片保留（数据含 bash 捕获，比官方产物行全），改默认优先级：官方产物行先选举，本卡片只出现在官方数据覆盖不到的回合；点击工作区内文件走官方 `openFile` 路由，工作区外产物打开右栏「产物」页并选中其改动记录
- 边界：工作区外的 bash 产物造不出 `dsh-resource://file/...` 地址（官方 `file` 资源限定工作区）——列表行带提示标记，但我们自己的详情页不受此限：内容与改动记录照常可看
- 行动作恢复（旧抽屉语义，详情页头部）：复制路径（始终）/ 在文件夹中打开（宿主半 `reveal` 选中文件，回退官方 open-in-app 路由开父目录）/ 在 IDE 打开（split button：主按钮首选 IDE、下拉列出全部探测到的 IDE；官方 open 路由只收目录，文件级走宿主半新方法 `openExternal`——macOS `open -a`，经 `/open-in-app/apps` 探测，无对应应用或非 macOS 时按钮隐藏）
- 打磨：改动记录与当前内容统一吃 `--dsh-content-font-size` 系令牌（官方 `--dsw-font-markdown-code-block` 固定 11px 不随设置，作用域内重绑到 `--dsh-content-font-size-secondary`）；详情头部面包屑段间加隙；「改动记录」tab 按需出现（fold 无 diff 记录时不显示）
- mention 打开直落详情页：就地包装官方 `chatFileMentions`（保留官方认领逻辑，open 改走 `openTab` 详情页、label 修为「在侧边栏打开」）；登记为缝 S1 的尾巴
- 产物打开入口统一：tab 类型升级为地址认领型（`patterns: ['dsh-resource://file/**']` + `canOpen` 按 fold 记录 + 可渲染后缀过滤，extension 档压过官方 fallback 档的 document tab；认不到/渲染不了自动回落官方）。官方产物卡片、文件树等 openResource 入口对产物文件都落我们的详情页
- 回合卡片选举确定性：显式 `priority: 1` 排在官方 deliverables（默认 0）之后——官方认领的回合永远显示官方卡片，本卡片只出现在官方数据缺失的回合

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
