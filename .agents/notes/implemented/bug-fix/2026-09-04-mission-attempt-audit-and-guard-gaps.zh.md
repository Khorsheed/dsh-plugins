# Agent Note: mission — 显式 submit 意向与可审计 retry

Status: implemented

[English](2026-09-04-mission-attempt-audit-and-guard-gaps.md) | 中文

## Problem

一次分支状态机的手工运行暴露了两个 guard 缺口。submit 预校验会合取当前状态全部以 submission 为输入的 schema 出边，因此互斥分支可能让所有 payload 都无效，即使最终 transition 的某一条 guard 本来可以通过。`file-check` 的目录期望又只证明目录存在，空的归档分区也能放行。此外，retry 新开 attempt 时没有记录原因；命名空间完整性输出没有暴露每个 ns 经哪个接口写入；宿主外 CLI 若要与实例的非默认数据根共用数据，只能每次重复路径。

这些都是 mission 层的通用机制缺口：包不能学会恰好暴露问题的具体场景词汇。

## Decision

`submit` 接受可选意向目标 `to`。预校验只选择这条已声明出边。未给 `to` 时，当前状态只有零或一条以 submission 为输入的 schema 出边仍保留原有便利；有多条则是用法错误，并列出全部候选边。意向目标不存储，也不移动 mission。`transition` 仍解析实际声明边并重新执行其 guard，因此 submit 的选择不能绕过状态机强制。服务面、模型工具与 CLI `--to` 适配器共用服务内核的这一决策。

`file-check` 中以 `/` 结尾的项现在表示「递归包含至少一个常规文件的目录」。路径不存在或类型不符报告为 `missing`；目录树没有常规文件报告为 `empty`。递归检查允许正常的嵌套归档布局，同时拒绝只有占位目录的树。

每次 retry 都必须提供非空自由文本 `reason`，以及 `infrastructure`、`operator`、`outcome` 三个通用类别之一。新 attempt 携带 `retry` 记录（`reason`、`category`、`at`、`by`），并以相同数据的 `kind: retry` 事件开始 history。初始 attempt 与旧 run 文件没有 `retry` 成员，仍可照常读取。模型工具与 CLI 强制两个字段；既有 slash 与 web tab 入口也收集并转交它们，因此任何已挂载界面都不能产生无审计原因的新 attempt。

命名空间完整性为每格新增 `writtenBy` 映射：每个 expected 或 present ns 都映射到当前 attempt 注解写入来源前缀的排序去重集合。带冒号的 caller 在第一个冒号处归一（`tool:session` 变为 `tool:`，`slash:session` 变为 `slash:`）；`cli`、`service` 等无冒号来源保持原样。缺失的 expected ns 映射到空数组。run status 展示这些事实，export 把它们写进 `manifest.json`；某个 ns 只有工具写入时不推断任何策略结论。

CLI 数据根的解析顺序是：`--data-dir`、`DSH_MISSION_DATA_DIR`、`DSH_HOME/state/mission`、当前工作目录 fallback。宿主插件配置刻意不读 `DSH_MISSION_DATA_DIR`：实例 patch 是进程配置，独立启动的 CLI 看不到，因此共用自定义根应由 CLI 显式声明。

## Alternatives considered

**状态有分支时跳过 submit 预校验。** 否决：这样会写入一个已经知道不满足所选路径的 payload，把有用反馈推迟到 transition。显式意向保留了早期、零写入的失败。

**尝试所有 schema，并从唯一通过者推断目标。** 否决：重叠 schema 可能多重匹配，schema 演进也可能静默改变选中路径；payload 不应靠推断移动或暗示状态。调用方本来就知道意向边，应直接命名。

**只把 retry 原因挂在旧 attempt。** 否决：原因解释的是新 attempt 为什么存在。放在新记录上能让导出的 attempt 自描述，history 事件则提供常规的时间线审计视图。

**要求期望目录的直接子级就有文件。** 否决：归档分区通常会嵌套文件。契约是递归非空，软链与特殊项不算常规文件。

**标警或拒绝仅由模型工具写入的 ns。** 否决：mission 负责 provenance，不负责信任策略。`writtenBy` 报告事实，解释留给消费者。

## Consequences

- 既有单 schema 模板保持 submit 行为；分支模板必须在 submit 时加 `to`，并保留每条分支的 guard。
- retry 刻意仍不幂等。重复同一 reason/category 会再开 attempt，但每个 attempt 现在都有归属和解释。
- run JSON 变更是纯新增。读取旧 attempt 时看不到 `retry`；写入者只为新的重跑 attempt 增加该字段与 retry history 事件。
- 过去能放行的空目录现在会让 transition guard 失败；嵌套常规内容无需新增模板字段或依赖即可通过。
- export 消费方新增 `writtenBy`，既有 `present`、`expectedPresent`、`missing`、`onlyUnlisted` 字段不丢失。
- 自定义实例 `dataDir` 与 CLI 默认保持解耦，除非 operator 用 `--data-dir` 或 `DSH_MISSION_DATA_DIR` 指向同一路径。

## Testing

`packages/mission/tests/state-machine.spec.ts` 用恢复两条 schema guard 的分支模板复现问题：正向分支带 `to` 可提交，省略时列出两个候选，负向分支带自己的目标可提交，transition guard 重新校验两种 payload，CLI 歧义以用法错误退出，空目录随后补入递归文件则证明 file guard 加强。服务、CLI、工具适配、slash、Remote 与 client 测试覆盖强制 retry 元数据和归属。原始旧 run fixture 证明没有新增字段的旧 attempt 仍可加载并接受新 retry。export 测试覆盖 run-status 文本及 export plan/manifest 数据中的缺失写入者与仅 tool 写入集合。

mission build 与全部 124 项 mission 测试通过；源码词汇检查和 `git diff --check` 无异常。`pnpm gate` 的第 1–8 步通过（含全树 hygiene、插件独立性、双语文档检查、脚本测试与全仓 build），但在第 9 步因既有 `ankh-guard` watchdog 测试失败而停止。持续失败的 composition recovery 用例已在 worktree 基点对应、未修改的本地 `main` 上同样复现，因此这里只把它记录为仓库既有 gate blocker，不在本 mission patch 中跨包修改。

## Cross-references

- [Mission 任务提案](../../../proposals/active/2026-08-19-mission-tasks.md)——本次细化的状态机、attempt、接口与命名空间完整性契约。
- [Mission export note](../feature/2026-08-19-mission-m2-export.zh.md)——`writtenBy` 所扩展的完整性报告与 manifest 形状的既有 owner。
- [Mission slash note](../feature/2026-08-19-mission-m2-slash.zh.md)与 [mission tab note](../feature/2026-08-19-mission-m4-tab.zh.md)——本次同步更新的既有界面，使服务面强制 retry 合约仍然可用。
