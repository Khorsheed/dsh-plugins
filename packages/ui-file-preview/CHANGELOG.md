# 变更记录

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
