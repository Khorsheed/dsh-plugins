# 变更记录

## 未发布

- **任务 tab 与 Typert Remote 数据面整体退役**：删除 `src/client/`（会话 tab、预设可见性）、`src/remote.ts` 与 `./client` / `./remote` / `./typert` 三个出口，包不再携带浏览器半边（`dsh.client` 移除）。tab 携带的人手操作——带原因与类别的重试、释放闸询问、逐层确认的导出对话框——由 eval 家族实验室面（运行记录抽屉）经 eval 自己的 Remote 与本包服务面闸承接；评测预设自 I5·T46 起本就不显示该 tab（界面规格 R6）。Remote 面是 tab 的唯一消费者（lab 走 CLI `--json`，eval 走 `ctx.mission` 结构面），随之退役；服务面、CLI、slash、工具行不受影响。
