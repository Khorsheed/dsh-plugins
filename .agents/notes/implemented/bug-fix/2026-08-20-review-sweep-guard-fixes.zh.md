# Agent Note: review-sweep fixes — resume decoupling, one state dir, atomic writes

Status: implemented

[English](2026-08-20-review-sweep-guard-fixes.md) | 中文

## Problem

一次针对 ankh-guard 的完整代码评审（新机重启测试期间）发现了四个值得修复的缺陷，外加一批经判断不修的项目（见 Consequences）：

1. **会话续跑被静默耦合到上报模式**（`src/index.ts`）：整个续跑半区——SIGTERM 快照、resume pass、continue 注入——都写在 `if (reportMode === 'followup')` 里，于是 `reportRestartContext: 'step'|'off'` 会在无报错无警告的情况下禁用中断会话恢复（而它默认开启）。
2. **状态位置的两套推导**（`src/cli.ts` + `scripts/dsh-watchdog.sh`）：CLI 的 `schedule-exit`/`supervise` 从 `DSH_HOME ?? dirname(stateDir)` 反推 home 再拼 `state`，而插件直接读 `stateDir`。只要 `stateDir` 不恰好是 `$DSH_HOME/state`（显式 `--state-dir`，或 `<cwd>/.dsh-guard-state` 兜底），marker、pidfile、重启记录就分裂到两个目录——上报和续跑双双静默丢失。
3. **`currentHead` 把 git 的 stderr 漏给父进程**（`src/git.ts`）：`execFileSync` 不传 `stdio` 时 stderr 转发到父进程，于是非 git 目录下每次门禁检查都往宿主日志打 `fatal: not a git repository…`——预期状态必须安静。
4. **持久化写入非原子**（`src/state.ts`、`src/restart-context.ts`）：`writeFileSync` 写到一半崩溃会留下截断的状态文件，而畸形状态文件会让 `loadState` 抛错——守护自己的状态把宿主的启动 invariant 搞挂。audit 数组也是唯一没有 predicate 校验、直接强转的字段。

## Decision

- 续跑半区只由 `resumeInterrupted` 门控，上报半区只由 `reportMode` 门控；两者任一开启即注册 `agent/created` 监听。顺带修了 `deliver()` 的两个潜在边角：pending-continue 条目改为注入成功后才删除（`followup` 抛错时会话下次创建仍有资格），以及"record 还没有 exitAt/error"时不再吞掉会话的 continue。
- 状态目录全局唯一：`schedule-exit` 把 `restart-requested.json`/`last-restart.json`/日志直接写进 `stateDir`；`supervise` 从 `stateDir` 读 pidfile，并把 `WD_STATE_DIR=stateDir` 传给 watchdog；watchdog 解析 `STATE_DIR="${WD_STATE_DIR:-$WD_HOME/state}"`，所有 marker、pidfile、attempt 日志、boot stamp 以及 guard 调用的 `--state-dir` 都用它。
- `currentHead` 传 `stdio: 'pipe'`，与同文件的兄弟函数一致。
- `saveState`、`acknowledgeRestartRecord`、`writeInterruptedSnapshot` 改为 tmp+rename 原子写；`loadState` 用 `isAuditEntry` 校验 audit 元素，与 credential/checkpoint 的 predicate 对齐。

## Alternatives considered

- **apply 时对不兼容配置组合抛错**（非 followup 模式 + resumeInterrupted 就拒绝）——这个组合本身合法（关上报、留恢复），有 bug 的是耦合而不是配置。
- **watchdog 继续从 WD_HOME 推导状态目录** —— 任何推导都在复制 CLI 已经知道的信息；把解析好的目录直接传下去是消除整类漂移，而不是缩小它。

## Consequences

- 回归覆盖：`reportRestartContext: 'off'` 下中断会话仍被 resume 并注入 continue；`schedule-exit` 在非 `<home>/state` 的显式 state dir 下 marker 和结果文件都落在该目录。
- 第二轮评审跟进（同日）：`supervise` 不再从 state 目录猜测实例的 home——`DSH_HOME` 未设时要求显式 `--home`，响亮拒绝（猜出来的 home 会让实例读错 profile/凭据目录）；`buildResumeOptions` 在 `agentDefaultModel` 存在但解析不出完整 provider/model 时告警（静默降级的止血；真正的修——加 peerDep + `import type` 拉声明合并——留给重构轮）；preflight drift tripwire 的 home 探测默认到 `~/.dsh`，在部署机器上真正运行而不是静默 skip（对 rc.8 验证通过）；测试端口改用 `freePort()`（bind 0）取代 `20000 + random`。
- 第三轮（同日）：`--home` 现在优先于 `DSH_HOME`（`resolveWdHome`）——CLI 里其他解析器全是旗标压环境变量，安装器自己的 `--home` 也是如此；两个安装器生成的单元现在显式传 `--home`，单元自解释且不怕环境被剥离。drift tripwire 按安装器的链解析 home（`DSH_WD_HOME` → `DSH_HOME` → `~/.dsh-official`，否则 `~/.dsh`），并把探测到的 home 写进测试名——哨兵盯的是部署真正在跑的那棵组合树（对生产上 23 行 patch 的大树验证通过）。两侧 README 已补 `--home` 文档。
- 第四轮（同日）：tripwire 的 home 其实从未到达组合过程——`composePreflightPatches` 内部自己读 `$DSH_HOME`，于是测试标题宣称大树、实际绿在小树。home 现在是 `composePreflightPatches` 的显式参数（harness 的 `resolveDshHome(configured)` 保留环境兜底），spec 把同一个 home 同时传给 runner 和 dump-config 子进程，并用 `profileDir` 断言钉住目标。状态目录有了单一 owner：`src/state-files.ts` 集中声明所有文件名（TS 侧全部改接；`lastGoodBootRevision` 移出凭据核心），`tests/state-files.spec.ts` 把 watchdog 的 bash 字面量门禁在它上面——三轮路径分裂 bug 的产地关掉了。同一份评审里的两个架构项有意留到重构轮：统一三份"找监听者并杀掉"的实现（以及是否退役 detached `restart` 编排），和把 `apply()` 拆成门禁插件 + 连续性插件两个。
- 以下项目仍是有意识地不修，而非遗漏：除上述告警外的结构类型/`as` 清理与 `checkPort`/`resolveHarnessRoot` 去重（无行为变化，记为重构候选）、`~/code/deepseek-harness` 默认值（仓库级约定，可用 `DSH_HARNESS`/`--repo` 覆盖）、`DSH_PREFLIGHT_COMMAND` 作为门禁旁路（测试钩子；守护本就不是针对"能设置实例环境变量的操作者"的安全边界——README 的信任说明已记录）、单文件测试套件的拆分（覆盖是真实的，慢但真实）。
