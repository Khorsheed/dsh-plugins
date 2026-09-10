# Agent Note: 评测 run 变成后台 job

Status: implemented

[English](2026-09-10-eval-run-as-a-job.md) | 中文

## Problem

`/eval run` 在命令轮次里 `await` 整个 run。三件事都由这一件事推出来。

**run 与发起者同生死。** 轮次是那个 promise 唯一的持有者，CommandInvocation 的 signal 从没接到任何东西上，而每次委派都以发起会话为父——发起端一断，整个 run 就没了（I3·T22 第 5 步记的正是这个现场）。一次 run 是几十分钟到几小时的真实工作、真实成本；提出它的那句话不是。

**CI 根本起不了 run。** 实例外的 `dsh-eval run` 除 `--dry-run` 一律拒绝，而且拒得对：进程外没有活的父 agent、没有 datasets/mission/localAgent 三个服务、没有作用域目录。但这道拒绝也让流水线**没有门**——起一次真 run 的唯一方式是一个人打开浏览器。

**也没有办法停一次 run。** run 循环里唯一的 `AbortController` 是每格的预算计时器，它上面没有任何东西够得着这次 run。

同一片区域还有两件小的：plan 路径与 `--out` 从不展开 `~`（slash 参数没经过 shell，CLI 参数为了活过 shell 常被引号裹住，两边都到不了展开），而 `run.ts` 里还留着一份 `validate.ts` 已经导出过的 `expandHome`；web-eval profile 的 `install.sh` 到第 176 行才第一次调 `dsh`——此前已经拷完 profile 文件、把 agent 预设整目录替换掉、（源码模式还）把每个成员构建打包了一遍，而 trap 只提 `$DEST`，`update.sh` 连 trap 都没有。

## Decision

- **run 是一个不带 owner 的 `eval-run` job。** `/eval run` 把它注册进 `ctx.jobs` 并立即回 job id 与 run id。不带 owner 是要点：带 owner 的 job 会随拥有它的 agent 被销毁而取消，而那正是要拆掉的耦合。于是 run 只在三种情况下结束：跑完、`job_kill`、服务销毁。
- **`--wait` 逐字节保留老形态。** 短的交互式 run 就该用它，而 `--dry-run` 永远同步（它在轮次内就跑完了，为一件已经做完的事发一个 id 是演戏）。没挂 jobs 服务的组合退回同步等待，并在回复**首行**写明——不因为接线问题拒绝一次 run。
- **取消只有一条路，而且就是预算计时器那条。** `job_kill` → job 的 `cancel` → `RunOptions.signal` → 与每格预算计时器同一个 `stopRound` 杠杆：abort 本轮 signal（委派带着它）并 `localAgent.cancel(childSessionId)`。被取消的格子**不重试**——对「操作者把它停了」回答「我再试一次」是答非所问——也**不推状态**：它停在取消时所在的那一步，`finalize` 因此把它读成 `interrupted`（T23 的分类）。一格都没开的格子留在 `pending`，那是 `not-started`；run 在 `run.meta.cancelled` 记一笔，bundle 照常导出——被取消的 run，它的格子也是证据。
- **父会话在 job 起之前解析，而要求是「活的 agent」。** 实测而非假设：家族门面的 `requireLiveParent` 解析 `ctx.agents.get(parentSessionId)`，答不上来就拒绝这一轮——一条会话记录不够。所以 job 在发起会话仍有活 agent 时用它（`/eval run` 的情形：agent 活过浏览器标签页），否则经 `ctx.agents.create` 自己开一条会话、run 结束时关掉（Remote/CI 的情形，那里根本没有发起会话）。回复里说明用的是哪一种。
- **输出被留存，并以两种方式供给。** 每一行日志都留在 job 记录里。registry 自己的读者（`readOutput`，`job_output` 驱动的那个）按一个游标消费；`runJobOutput(jobId, cursor)` 按下标读另一个游标。一份留存数组上的两个游标，于是 CI 轮询与模型面工具不会互相吃掉对方的行。
- **Remote 面就是 CI 的门。** `dshEval.runStart / runStatus / runOutput / runCancel` 是同一套 job 层上的同四个动词——没有第二份 run 实现。四个都不收 agent 参数：CI 调用方没有 agent，要求它等于把门又锁回原样。`dsh-eval run --instance <url> [--token …]` 经实例普通的 Remote RPC 驱动它们（`POST <base>/api/dshEval/<method>`，`{args:{…}}` 进、`{ok,value}` 出，启动 token 走 `?token=`），跟着日志跑到结束，退出码即 job 结局。不带 `--instance` 时 CLI 仍只做 `--dry-run`。
- **`~` 在服务边界展开。** `EvalService.run`、`report`、`validatePlan` 展开它们收到的路径，三个面共用一条规则，而不是三个各自要记得的调用点；`run.ts` 那份私有副本删掉，只留 `validate.ts` 的导出。
- **profile 脚本先检查机器。** `install.sh` 与 `update.sh` 现在第一步就查 `dsh` 在 PATH、`dsh --version` 能跑、以及 profile pin 的 `headlessBundleDir`——从 `cordis.patch.yml` 里读而不是写死，因为要成立的正是那条 pin。全部通过之前不写任何文件。预设目录在被整目录替换前备份，trap 里点名备份在哪；`update.sh` 补上了 trap，以及它覆盖的 pin 文件的备份。

## Testing

- job 生产者，对着一个语义与真契约相同的假 registry：run 还什么都没做时就有 id、与 registry 消费型读者并行的非消费游标、不带 owner 的注册、cancel 抵达 run 的 signal、发起方没有活 agent 时自开父会话（并在 settle 时释放）、以及一次拒绝被记成 `failed` job 且诊断进日志。
- slash 两个面：缺省起 job（不带 owner、带 label、回复里点名唯一取消路径）、`--wait` 与 `--dry-run` 保持同步、以及没挂 jobs 时的退回首行。
- run 循环的取消，用真 `AbortController` 走 `runPlan`：在跑的委派被取消、格子记 `cancelled` 且**不重试**、后面的格子一格都没开、`meta.cancelled` 置位、`cell-cancelled` 注解写下。
- instance 客户端：参数**按名**传（线上自己的形状）、token 进 query、跟随循环的游标推进、以及 401/404 点名可能原因的报错。
- 服务边界的路径展开。
- 两个 profile 脚本的 shell 夹具：`dsh` 不在 PATH 时、以及 patch pin 的 headless 路径不存在时，脚本都以退出码 2 打印 `nothing has been written`，而预设目录里的标记文件与已安装的 profile 文件一个字节没动。

## 真机验证

在评测实例（`:3171`，`DSH_HOME=~/.dsh-lab`）上，用 profile 自己的源码模式安装器装上本分支：

| 检查 | 结果 |
|---|---|
| CI 那道门 | `dsh-eval run <plan> --instance http://127.0.0.1:3171 --dry-run` 经 Remote 起 job、跟日志、按 job 结局退出——整条路上没有浏览器 |
| run 活过发起者 | `--no-follow` 起了 `eval-run-3` / `run-20260910055932-fwnx`，发起进程**退出**（比关标签页更彻底）。run 继续跑；**另一个进程**轮询 `runStatus` 到 `completed`，并用 `runOutput` 把全程日志读回来 |
| 自开的父会话 | run 给自己开了 `3a4bd82f…`（Remote 这道门没有发起会话），回复里写明了 |
| 报告路径在结束行 | `bundle: …/exports/run-20260910055932-fwnx-bundle`，随后 `run … finished — 1 cell(s): …` |
| profile 前置检查 | 本 shell 的 PATH 上没有 `dsh` 时，`install.sh` 以退出码 2 打印 `preflight failed — nothing has been written`，在碰 `$DSH_HOME` 之前退出——第一次就把作者自己的 shell 拦下了 |
| 复算逐字节相同 | pilot-a-round1 bundle 复算出的 `results.jsonl`（sha256 `a05244bc…`）与 `usage.jsonl` 与 `main` 相同 |

两个真问题是在这里暴露并在本次改动里修掉的：启动 token 只在**一道门**上被接受（`GET /?token=…`，它换出后续每个请求带的 cookie），以及 RPC 体是连接层自己的信封（`{type:'client-request', rpcId, method, payload:{args}}`）而不是裸 payload。第三个——`ctx.jobs.start` 以「no job controller serves this agent」拒绝 unowned job——正是本包自己挂一个 controller 的理由。

**实例上没能证明的那一项，以及原因。** 两阶段格子在那里没走到 `archived`：每次 resume 轮都报 `childSession.snapshotEvents is not a function`。这是**宿主线不匹配**，不是本次改动：`snapshotEvents` 是 2026-09-09 的 `feat(packages): adapt all plugins to host 0.1.2-rc.1` 把插件迁到新 API 面时引入的，各包的兼容性一节都写着 `minHost 0.1.2-rc.1`；而实例跑的是 `stable` 工具链、dsh 0.1.1-rc.2，那条线的 Session 没有这个方法。判据：同一次 run 里就绪探测与 stage1（fresh 委派，从不 resume）都正常完成，而同一份插件构建在实例之外能把 stage1 与 stage2 推到 `archived`。job 机制——起、活过发起者、日志、settle、导出——是验过的；「格子在 3171 上走到 archived」等的是那台实例的工具链。

## Alternatives considered

**把 CommandInvocation 的 `AbortSignal`接进 run，run 仍留在轮次里。** 拒绝：它修的是错的那一半。run 仍然随轮次结束而结束——那正是要拆掉的行为——而且会给 run 添第二个取消入口，与第一个抢。job registry 本来就是「活过发起者的工作」这件事的归属，连列出、读取、杀掉的模型面动词都已经有了。

**让发起 agent 持有这个 job。** 同一句话就能拒绝：带 owner 的 job 会随 owner 被销毁而取消。对一条 bash 命令这是好缺省；对一次「整件事的意义就是活过这个会话」的 run，这就是那个 bug。

**给 run 自己一个 `/eval stop <runId>`。** 拒绝：第二条停止路径就是第二处可能只接了一半的地方，也是读者第一件要分辨的事。`job_kill` 已经存在、已经在评测预设里、而且只够得着一根杠杆。

**让 CLI 在进程内挂起服务、自己驱动 run。** 拒绝：那需要 datasets、mission、localAgent 三个服务、一个活的父 agent、以及实例的作用域目录——那不是 CLI，那是第二个实例；而作用域目录恰恰是不能复制的那一样（回读读的就是那一轮写下的东西）。去调用**已经拥有它们**的那台实例，是更小也更真的做法。

**让 Remote 面像 mission 的 tab Remote 那样收一个 agent 参数。** 拒绝：那些 Remote 服务的是永远有 agent 的浏览器。这个面存在的理由正是「调用方没有 agent」，收 agent 参数等于给这道门装上老门的同一把锁。

**用 Remote 事件流推日志，而不是游标读。** 暂拒：轮询是 CI 本来就会做的事（也是断线后不需要 resume 协议就能续上的做法），游标是更小的契约。等浏览器面要看实时行时，流是自然的升级。

**`expandHome` 留在 `run.ts`，各调用点各展开。** 拒绝：三个面走同一批动词，写在调用点的规则就是下一个调用点会漏掉的规则。

**把机器前置检查放在 profile 脚本末尾——反正 `dsh` 在那里才第一次被用。** 拒绝：到那时预设目录已被整目录替换，源码模式下每个成员也已构建打包完毕。**机器的**前置条件要在什么都还没变的时候查，那才让「nothing has been written」是脚本能诚实打印的一句话。

## Consequences

- run 活过标签页、会话与发起它的那一轮；CI 流水线不用浏览器也能起、看、停一次 run。
- `/eval run` 的缺省回复换了形状：现在是两个 id 加日志在哪读，不再是 run 的报告。要老回复的场合用 `--wait`。
- eval 包多了两个可选 peer 依赖（`@deepseek-ai/dsh-jobs` 提供生产者契约与 `eval-run` 这个 kind，`@deepseek-ai/dsh-typert-protocol` 提供 Remote 面）与它的第一份 Typert 生成产物；lockfile 记下 jobs 那条。
- 取消一次 run 会**故意**把格子留在半途。`finalize` 本来就有这个分类（`interrupted`），报告现在也把它与「一格都没开」（`pending` / `not-started`）分开。
- profile 脚本失败得更早、更频繁——这正是要点。缺 `dsh` 或缺那条 pin 的机器现在一秒内就知道，而它已安装的 profile 与 agent 预设完好无损。
