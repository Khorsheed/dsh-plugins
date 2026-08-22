# Agent Note: taskpilot 轨迹启动行携带实际下发的命令

Status: implemented

[English](2026-08-21-taskpilot-trajectory-command-lines.md) | 中文

## 问题

任务详情抽屉的执行轨迹是从会话日志折叠出来的,但后台 bash 启动只产生一行很薄的记录:工具 ack 文本就是字面的 `started background job bash-1`——没有命令、没有上下文。用户反馈 bash 任务的轨迹"只有 started background job bash-1"。

## 决策

启动行现在展示模型实际下发的命令,取自会话日志里已有的 `tool/call` 参数(绝不触碰宿主的消费式读取游标):

- 标题:`HH:MM:SS bash-1 started · <command>`,命令截断到 80 字符加省略号;
- 可展开详情:命令块(`$ <command>`、`workdir:`、`description:`)后跟 ack 文本;
- 配对的 ack 缺失或为空(分页截断、compaction)时,只要调用参数能证明是本任务的后台启动,仍会铸出启动行。

后台任务的完整原始 stdout 依然刻意不拉取:宿主注册表只通过单一消费式游标 `jobs.read` 暴露流输出,而模型的 `job_output` 调用与之共享同一游标;UI 读取会静默偷走模型即将收集的输出。该约束不变,仍记录在 README 的已知限制中。

## 备选方案

- **宿主半区为抽屉读取 `ctx.jobs.read`** —— 否决:对流类型(bash)读取会消费 delta 并把任务标记为已报告,偷走模型下一次 `job_output` 的输出并改变通知语义;注册表没有非消费式 peek。
- **不展示任何新内容** —— 否决:命令和参数本就在日志里,渲染零成本。

## 后果

- 轨迹更丰富、但仍是模型视角:即使模型从未浮出输出,命令与参数也可见;输出本身依旧只是模型读到的东西(或完成通知里的状态)。
- 对任务注册表与模型读取游标零副作用;折叠仍是作用于持久日志的纯函数,compaction 只会让它退化到更少的行,绝不抛错。
