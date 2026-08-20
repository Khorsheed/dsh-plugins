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
- 第五轮（同日）：状态目录协议还有门禁视野外的写者——两个 supervisor 安装器往里写 `watchdog.log`/`watchdog.stderr.log`/`watchdog.pid`，而 `watchdog.stderr.log` 甚至没有声明。`STATE_FILES` 补上了 stderr 日志；pin 测试现在扫全部三个 bash 侧；新增断言禁止在 `STATE_DIR=` 默认值之外的任何地方从 home 重新推导状态目录（第二轮 bug 的同一个形状）；`install-launchd.sh` 残留的 `$HOME_DIR/state/watchdog.pid`（比 `STATE_DIR` 的定义早 21 行）改为和 systemd 孪生一致地用 `$STATE_DIR`。
- 第六轮（新机安装报告）：exit agent 改为随包发布的真文件（`src/exit-agent.ts`，经 `process.execPath` spawn，source/built 拆分与 `guardInvocation` 同款），不再是 `node -e` 字符串——进类型检查、可单测，TS 侧的 kill/定位原语收口到 `src/processes.ts`；`--log` 遇到 `--foreground` 响亮拒绝（foreground 的日志归外部监督器的重定向管，两个安装器删掉了多余的 `--log`）；watchdog 在拉起非计划退出的实例时留下 `{ unexpected: true }` 记录，崩溃恢复不再静默（两个报告渲染器都加了文案分支，且不覆盖待上报的记录）；`SRC_ARTIFACT_PATTERN` 移到 `defaults.ts` 并作为 `commitCheckpoint` 的参数；两侧 README 新增"已知安装坑"（GitHub 安装会现场构建、pnpm allowBuilds、npm 缓存 root 属主、`--start` 的 cwd、沙箱继承）。
- 第七轮（对第六轮的评审）：崩溃记录的写入从 watchdog 里的内联 `node -e` 整体搬进 `record-unexpected-exit` CLI verb（待上报保护与原子写回到 TS、可单测），并修掉首启误报——watchdog 在循环顶部先快照 last-good-boot 戳，只有本部署成功起来过才调 verb，全新安装的首次启动不再误报崩溃。覆盖钉住两侧：全新 state 目录启动不留记录、有戳部署的接管留记录、verb 从不覆盖待上报记录。
- 第八轮（第二次新机实测）：full-access 前提现在能在运行时到达 agent——`verify` 和 `record` 的输出带提示（README 章节不保证被读到）；首装 bootstrap gap 有了运行时守卫：`schedule-exit` 找不到存活 watchdog 时响亮警告（裸退出会让服务躺平），两侧 README 写明安装后的第一次重启必须用 CLI `restart`（或先装系统监督器），因为运行中的实例还没加载插件。
- 第九轮（第三次新机实测）：bootstrap 警告前移到 agent 的必经触点——没有存活 watchdog 时 `verify` 和 `record` 都会告警（stderr），并点名两条出路（`supervise` 接管后任何退出都会被拉起；`restart` 自带首次全循环）。README 前提里把"add 后立刻 supervise"列为最轻的 bootstrap 方式。理由：裸退出实例的 agent 既没读 README 也没碰过 guard 的任何输出——警告必须在每个流程的起点命令上开火。
- 第十轮：full-access 提示带上了切换路径——在**当前会话**执行 `/permission danger-full-access`（设置页只影响新会话；有打开中的持久终端会被 fence 拒绝）。起因是新机实测里 agent 拿着"confirm full access"无从下手。CLI 提示与两侧 README 同步更新。
- 第十一轮（对并发批次的评审）：`restart` 持跨会话锁到动词结束——`restart.lock`，`wx` 原子创建 + stale 回收；空锁文件不等于任何持有者（`Number('') === 0` 且 `kill(0, 0)` 永远成功——它曾被读作"存活"，会让 restart 永久拒绝；同一个 0 号 pid bug 在 `liveWatchdogPid` 里也修掉了）。`schedule-exit` 拒绝第二个待处理 marker，但 15 分钟 TTL 后过期（`requestedAt`——中途死掉的 watchdog 不再卡死调度）。watchdog 的 pidfile 自愈：被删则下一次轮询内重新占位（健康等待改成了轮询循环而不是裸 `wait`）；被另一个存活进程持有则让位且**不**杀自己拉起的实例（`yielded` 跳过 cleanup 的 kill）。评审抓到：锁的 unlink 所在的 catch 同时吞掉了一个缺 import 的 ReferenceError——tsc 抓住了它，教训已记录。
- 第十二轮：restart 锁改为 try/finally——五个手工释放点消失，异常路径不再遗留锁（同进程调用者遗留的锁会因"持有者永远活着"而永久拒绝）；rollback（全 verb 破坏性最强的一步）现在锁内执行：第二个 restart 不能再在 `reset --hard` 进行到一半时读 HEAD 或 preflight 这棵树。
- 第十三轮：两个能停实例的动词此前互不可见——`restart` 持锁但不看 marker，`schedule-exit` 查 marker 但不看锁——于是一个待发的 exit agent 可以 SIGTERM 掉并发 `restart` 刚拉起的新实例。现在不变式双向强制（共享 `restartMarkerState`/`liveRestartLockHolder` 两个 helper）：有新鲜 marker 时 `restart` 拒绝，锁有活持有时 `schedule-exit` 拒绝。任何会停实例的 verb 都能看见其他所有待执行的停机。
- 第十四轮：full-access 指引现在明说 agent 自己无法切换沙箱（这正是沙箱的意义）——`/permission` 是用户输入的命令，提权也需用户审批；新机实测里 agent 曾卡在尝试自助切换上。
- 第十五轮（第二次托管回收事故）：`restart` 现在自我 detachment——门禁在调用方进程里跑（拒绝即时可见），然后 停→起→canary 半区以 setsid 形态重新 spawn（`DSH_ANKH_RESTART_DRIVER`，日志在 `<state-dir>/restart.log`，锁记在 driver 的 pid 上）。运行在实例托管进程树里的 restart CLI 会死在"旧实例已停"和"新实例未起"之间（harness teardown 杀托管进程；`nohup`/`disown` 不逃脱）——两次实测。`--sync` 保留进程内形态供测试/调试。另外：沙箱探针（`check-env`，外加 restart/schedule-exit/supervise 上带 `--force` 逃生口的硬门）取代了"希望 agent 读了权限文档"——沙箱化调用方已被证明留不住 detached 子进程，所以 verb 直接拒绝并点名 `/permission danger-full-access`。入口守卫改为符号链接免疫（`isDirectInvocation`）：纯 URL 比较在 /tmp 符号链接下静默不触发，进程什么都不做就退出 0。
- 以下项目仍是有意识地不修，而非遗漏：除上述告警外的结构类型/`as` 清理与 `checkPort`/`resolveHarnessRoot` 去重（无行为变化，记为重构候选）、`~/code/deepseek-harness` 默认值（仓库级约定，可用 `DSH_HARNESS`/`--repo` 覆盖）、`DSH_PREFLIGHT_COMMAND` 作为门禁旁路（测试钩子；守护本就不是针对"能设置实例环境变量的操作者"的安全边界——README 的信任说明已记录）、单文件测试套件的拆分（覆盖是真实的，慢但真实）。
