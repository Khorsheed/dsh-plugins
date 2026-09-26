# Agent Note:部署 ankh-guard 自身要走 `reconfigure`,不是 `schedule-exit`

Status: implemented

## 问题

`pnpm deploy:3080 --package packages/ankh-guard …` 会在第 5 步自我卡死。活 watchdog 持久化的 launch spec 用**路径 + sha256** 钉住 preflight runner,而那个路径就是仓库构建产物(`packages/ankh-guard/lib/preflight-runner.js`)。部署第 1 步重建 ankh-guard,只要 diff 动了 `preflight-runner.ts`,被钉的文件就被改写;`schedule-exit` 时**旧** watchdog 拿当前文件对比录得哈希,不匹配,以 `the bound preflight runner changed after launch configuration` 拒绝——这是基础设施失败而非组合判定,实例继续运行,什么都不重启。不动 runner 的 ankh-guard 部署永远踩不到(重建字节一致),所以这个缺口直到 2026-09-26——绑定机制落地后第一次改 runner——才浮现。

紧随其后还有第二个独立绊索:cutover canary 会重验绿构建凭证(`verify` = 新鲜 + 宿主检出 HEAD 匹配),新鲜窗口 **10 分钟**。一次 schedule-exit 拒绝 + 几分钟排查 + reconfigure 自己的组合 preflight(约 2~3 分钟)+ 启动,轻松把凭证推过 10 分钟——2026-09-26 第一次 reconfigure 尝试就在第 13 分钟 canary 失败、干净回滚(`restore-previous` 符合设计)。

## 决策

部署包含 ankh-guard 且撞上 runner 哈希拒绝时:

1. 让部署走完第 1–4 步(构建+测试、pack、profile 刷新、录凭证)——拒绝不会动它们,也不停任何东西。
2. 用新 runner 跑一次诊断 preflight,在真实 profile 上零风险自证:`DSH_HOME=$HOME/.dsh-official node packages/ankh-guard/lib/cli.js preflight --profile web --preflight-surface built --preflight-install-anchor <harness>/apps/cli/package.json`。
3. **重启前立刻重录凭证**(10 分钟窗口必须覆盖 preflight + 启动 + canary):`record build --trust-command --command 'pnpm deploy:3080 (build+test green)' --repo <harness>`。
4. 用 `reconfigure` 重启——受支持的事务化路径,会重绑 launch spec(runner 哈希按当前文件重算)并以 `--on-failure restore-previous` cutover。每个字段都从活 `launch-spec.json` 照抄(`active.command`、`home`、`credentialRepo`、`harnessRoot`、`profile`、`preflight.*` 含 `candidateProbeCommand`),不要新造启动命令。2026-09-26 会话里有完整示例;命令很长但只是逐字段复制。
5. 验证:watchdog 日志出现 `canary PASS`、`launch-cutover.json` 到 `phase: ready`、spec 的 `runnerSha256` 与盘上文件重新一致。

绝不用「临时换回旧 runner 字节」绕过拒绝:respawn 的 watchdog 继承持久化 spec,下一次重启闸门会在同一处再绊一次——只有 `reconfigure` 能耐久重绑。

## 否决的方案

**先临时换回旧 runner 字节跑 schedule-exit,跑完再重建。** 否决:respawn 的 watchdog 继承持久化 spec 里的旧哈希,而仓库文件已是新构建,之后每次重启闸门都在同一处再绊;而且重启后的 guard 自己的 `verify-restart` 可能把这份漂移读成篡改。只有 `reconfigure` 能耐久重绑。

**让 deploy-3080 检测「包里含 ankh-guard」时自动改走 reconfigure。** 正确的结构性修法,刻意缓做:cutover 的每个旗标都必须从活 `launch-spec.json` 逐字段照抄,自动化写错就是把错误启动命令写进生产。本 note 即过渡 runbook。

**手动 kill 宿主子进程让 watchdog respawn。** 否决:无闸重启绕过 AGENTS.md 给 3080 定的 preflight 契约,且反复启动失败会冒 watchdog 回滚宿主检出的风险。

## 后果

2026-09-26 部署:ankh-guard 0.3.1(preflight 挂载自己算出的 runtime resolution)+ taskpilot 0.3.1 正是沿这条路上线 3080——修复后的 runner 组合 preflight PASS、cutover `ready`、canary PASS、runner 重绑核验一致。结构性缺口仍在:deploy-3080 可以检测「包里含 ankh-guard」时自动改走 reconfigure,或把录凭证挪到流水线更后面;在有人做掉之前,本 note 即 runbook。

## 相关

- [preflight 挂载自己算出的 runtime resolution](2026-09-26-preflight-mounts-runtime-resolution.zh.md)——触发本次缺口的那个修复。
