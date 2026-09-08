# Agent Note: 机器级测试准入与逐任务 lane 诊断

Status: implemented

[English](2026-09-08-test-admission-and-lane-diagnostics.md) | [中文](2026-09-08-test-admission-and-lane-diagnostics.zh.md)

## Problem

跨 worktree 并发 gate 报告 Ankh Guard 的预期清单为 190、实测为 178 或 163。只识别通过数的表达式 `/Tests\s+(\d+) passed/` 无法读取 Vitest 失败优先的汇总 `Tests 1 failed | 11 passed | 128 skipped (140)`：整个十二测试分片被漏算，而不只是失败的一条。检查本地安装的 Vitest formatter 和回归测试证明了这个统计缺陷，但不能证明历史运行具体失败了哪些测试，也不能证明资源耗尽、OOM 或 skipped 是根因；历史逐任务产物没有提供。gate 此前还会在失败后删除 tee 日志。

每条 lane 内部四路并行，不能限制不同 worktree 同时跑多条 lane，Vitest 子进程内部还会增加 worker 并行。另一个问题是 gate 从展示列表中删除了 root，却仍执行原选择器。当 root 和真实包一起被选中时，root 的递归 build/test 会越过预期包闭包。仅选中 root 的 docs-only 情况已经会归为无包变化，并非每次文档改动都能复现递归。

## Decision

### 结构化结果，不隐藏重试

每个 lane 任务将 Vitest JSON 报告、stdout 和 stderr 分别写入私有 OS 临时目录中的 mode-0600 文件。runner 等待 `close`，处理 spawn 错误，验证报告，并检查显式的逐任务通过清单。输出 passed、failed、skipped、todo、缺少的通过数、退出码、signal、失败测试名称/消息与产物路径。JSON 缺失或不一致、suite 错误、非零退出、信号和计数不匹配都会失败。名字过滤与静态分片产生的合法 skip 可见，但不算通过。

最终 `summary.json` 包含开始/结束时的 load average、外部测试进程数、git HEAD、built CLI 路径/hash、任务结果和基础设施错误。即使发生基础设施异常，也会等所有已启动 worker 完成后才释放准入。成功运行也保留原始日志与 JSON；保留周期由 OS 临时目录生命周期管理，不归进程 lease reclaimer。gate 失败时保留自己的 tee 日志。不自动重试，不改变通过阈值。

首次带诊断的总入口运行通过了全部 194 条断言，却在 `lifecycle-drift` 非零退出：Vitest 报告 `[vitest-worker]: Timeout calling "onTaskUpdate"`。真实 home 循环链接测试的一段同步测试体耗时 71.2 秒。这是 runner/RPC 失败的直接证据，区别于历史缺少通过数的报告。该测试现在异步等待有界 CLI/install/probe 子进程，在有界 worker thread 中运行刚构建产物里的同步 snapshot 实现，并异步等待大目录清理。worker 返回 snapshot 坐标后必须退出；链接图包含与 live 字节不变的原断言保持不变。生产 snapshot 实现与 Vitest RPC 超时均未修改。

### 两层有界准入

`test-resource.mjs` 是内部测试工具，不是发布的运行时入口。root gate 与独立 Ankh Guard lane 共用它，避免镜像依赖根工具。独立的 `gate` 和 `ankh-integration` 资源放在跨 checkout 共享、按用户隔离的私有 OS 临时命名空间。新版 gate 彼此串行；integration 和总入口 lane 彼此串行。锁顺序为先 gate、后 integration。每个 Vitest lane 子进程恰好一个 worker；每条 lane 最多四个任务并行（unit 为两个）。

排他创建的锁记录 PID、随机所有权 token、cwd 和创建时间。等待者每十五秒报告持有者和已等时长，二十分钟后失败。这是等待可用性的有界轮询，不是执行前固定延时。持有者已退出或记录不可读/卡住，都不授权自动回收或发信号，因为后代可能仍存活。调用方只在自己工作完成后释放 token 匹配的锁。异常终止保留锁供审计；刻意不使用可能在 detached 后代仍存活时提前释放的 exit hook。PID 复用只会延迟/拒绝准入，不会授权杀进程。隔离测试通过函数参数注入 root，不使用生产环境变量开关。

准入是协作式的：旧 checkout、独立 build、直接 Vitest 调用和其他负载不参与。它减少 gate 嵌套竞争，但不是全机 CPU/RAM 调度器，也不保证负载绝不会导致失败。诊断靠证据，不仅靠 `loadavg`。

### 作用域与运行时边界

选择、build 和 test 共用排除 root 的过滤器。依赖闭包和共享路径退回全量的规则不变。选中 Ankh Guard 时仍跑完整总入口；全量 gate 和 CI 保留两档。无关改动不再通过 root 递归牵入它。不把共享层验收降为只跑 unit。

本轮不修改生产 cutover、checkpoint、超时、profile 或宿主源码。近期报告的 checkpoint 消息与 `profiles/web-eval/scripts/restart-into-web-eval.sh` 中的显式调用匹配，该脚本解析 profile 安装的 CLI。当前 clean-tree checkpoint 记录已有 HEAD，dirty checkpoint 必须显式 `--include-dirty`；watchdog 不创建 checkpoint 提交。单凭历史空提交不能识别当时执行的产物。这是安装产物/调用方审计边界，不是再加一层 watchdog 提交策略的证据。

## Alternatives considered

**自动重跑不完整分片。** 拒绝：断言失败本身就会让旧 parser 漏掉分片。重跑会混淆真实失败与观测错误，并可能把有价值的红灯变绿。

**只扩大 timeout，或在 `ps` 看起来忙时降低并行度。** 不作为协调机制：同时进入的两个任务都可能看见空闲，进程名/load 不是所有权。显式协作准入限制参与者，诊断仍暴露不参与的负载。

**把 integration 移出普通 gate 或降低预期计数。** 拒绝：会移除曾发现真实缺陷的进程/所有权覆盖。排除 root 能纠正作用域，无须删减被选中的覆盖。

**自动回收已死的准入持有者。** 暂不采纳：父进程死亡不证明 detached 后代已经结束。自动恢复需要后代所有权证据，而不是陈旧 PID 启发式。

## Consequences

并发 agent 用一定排队时延换取较少的重型测试重叠和可诊断的失败证据。测试移动时仍需维护逐任务清单。gate 崩溃可能需要人工审计保留的锁和后代；正常失败会在同步命令和 lane worker 完成后释放准入。准入不杀任何进程，资源竞争不会变成静默跳测。跨进程 ACK 测试建立 acquire → busy → release → acquire 顺序，不靠 sleep 猜重叠；结构化结果测试固定失败优先的汇总、信号、缺失报告和清单不一致。这扩展了[生命周期所有权设计](2026-09-05-ankh-guard-watchdog-test-lifecycle.zh.md)，不改变生产语义。
