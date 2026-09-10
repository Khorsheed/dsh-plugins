# 变更记录

## 0.3.0（2026-09-10）

迁入官方 0.1.5 右栏体系，退役绕行缝 S1。

- **BREAKING**：minHost 前移至 `0.1.5-rc.1`；宿主 `0.1.2-rc.1` ~ `0.1.4.x` 的用户请停留在 0.2.x 线
- 「产物」从 `conversation.view` tab 变为右栏 page-type tab（向导页进入）：纯文件列表
- 内容预览整体交给官方 document tab：点击工作区内文件经 `openResource('dsh-resource://file/session/<id>/<path>')` 渲染（Markdown/代码/图片/PDF/HTML 官方渲染器）
- 改动记录（逐次 write/edit diff 步进，本插件独有，保留自绘）成为官方预览页的可切换渲染器：工具栏下拉选「改动记录」（`ctx.documentPreviews` + keyed `sidebar.right.tab.document`，`priority: 'builtin'` 不抢官方默认渲染）
- 退役：`shell.overlay` 预览抽屉、正文 mention 的捕获阶段 DOM 拦截、turnTail 的 `priority: -1` 抢占、自绘文档预览（Markdown/JSON/CSV/HTML 沙箱渲染）
- 回合变更卡片保留（数据含 bash 捕获，比官方产物行全），改默认优先级：官方产物行先选举，本卡片只出现在官方数据覆盖不到的回合；点击工作区内文件走官方 `openFile` 路由，工作区外产物打开右栏「产物」页并选中其改动记录
- 边界：工作区外的 bash 产物造不出 `dsh-resource://file/...` 地址，列表中仅可选中（行内提示）；其内容与改动记录均无预览面，不另做自绘
- 列表行恢复行动作（旧抽屉语义）：复制路径（始终）/ 在文件夹中打开（宿主半 `reveal` 选中文件，回退官方 open-in-app 路由开父目录）/ 在 IDE 打开（官方 open 路由只收目录，文件级走宿主半新方法 `openExternal`——macOS `open -a`，经 `/open-in-app/apps` 探测，无对应应用或非 macOS 时按钮隐藏）
- 正文 mention 打开方向统一进右栏：就地包装官方 `chatFileMentions`（保留官方认领/文案，open 全走 `owner.openFile`）；登记为缝 S1 的尾巴
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
