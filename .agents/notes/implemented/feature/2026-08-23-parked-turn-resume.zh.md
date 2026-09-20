# Agent Note: 泊着的回合不被恢复——续跑边界修正

Status: implemented

[English](2026-08-23-parked-turn-resume.md) | 中文

实施[提案 2026-08-23-parked-turn-resume](../../../../proposals/closed/2026-08-23-parked-turn-resume.md)。

## 问题

SIGTERM 快照用 `agent.status === 'running'` 判定"有活回合"，但阻塞在等待用户输入（未回答的 `ask_user_question`、未决审批）的回合也是 `running`。3080 升级日实证：泊在提问卡片上的会话在每次重启恢复时都被唤醒——重放报告、重复提问、白烧回合（「梦境守护者」会话在三次非计划退出中每次都被叫醒）。泊着的回合没有被中断的工作：卡片持久在日志里，用户随时能答。

## 决策

- 新增纯探测 `isParkedOnUserInput(events)`(restart-context.ts)：最后被中断的回合，若其尾部阻塞在未回答的 `ask_user_question` 调用或未决的审批（有 `approval/asked` 无 `approval/decided`）上，即为泊着。
- resume pass 整体跳过泊着会话（不重建 agent);`deliver()` 对泊着会话丢弃续跑注入，但仍投递应得的重启报告（仅报告文案，不用合并版）。探测按 boot 记忆化、异步（信号处理器保持同步），持久化服务缺席或出错时失败开放为原行为。
- 防双发：`pendingContinue` 条目在（同步的）`followup` 前先删除、抛错时重新挂回——两个恢复触发可能并发等同一个记忆化探测。
- SIGTERM 快照本身不变（它不能 await)；过滤发生在恢复/投递路径——"快照之后才泊下"的竞态也在这一层被接住。

## 考虑过但未选

- **在 SIGTERM 里通过待答查询服务过滤**——不存在这样的查询口（`UserQuestionService` 是 provider 注册表，不是 pending 状态存储），而且信号处理器反正不能 await。修复后的日志尾部是可用的真相源。
- **把泊着会话当作完全无感（连应得报告也不发）**——否决：泊在流程中段的发起者仍然需要重启结果；只丢弃续跑那一半。

## 后果

- 泊在用户输入上的会话在重启后表现得与空闲会话一致：安静。它们的卡片照常可用（之后回答不受影响）。
- 验收：四会话测试新增泊着用例——快照中的 `session-parked` 既不恢复也不续跑，而真正在干活的兄弟会话照常恢复续跑。
