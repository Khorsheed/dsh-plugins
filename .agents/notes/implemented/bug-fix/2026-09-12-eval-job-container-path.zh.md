# Agent Note：job 起的 run 能走容器路径，单元先说自己够不够得着

Status: implemented

[English](2026-09-12-eval-job-container-path.md) | 中文

## 问题

一次 run（I4·T29c）里出的两个毛病，共同点是：编排器自己的管道出了事，话却说得像是受试对象的错。

**job 起的 run 拒掉每一个容器条件。** 就绪探针回的是 `subagent-codex: the parent session has no working directory to run the CLI in`，一格都没跑就整轮拒绝。链条是这样的：容器路径**刻意不传**每轮 `cwd`（单元里宿主路径没有意义），provider 于是按 `intent.cwd ?? parent.session.header.cwd` 取值，而没有发起会话的 run——Remote/CI 这扇门，以及发起会话本身没有 cwd 的 `/eval run`——是用 `ctx.agents.create` 自己开一条父会话的，那条会话没有 cwd 可给。于是容器路径在浏览器标签页里能跑、在 CI 里不能跑，而解释原因的那句话点的是 harness 的名字。

**断网的单元给出的是空回答，不是错误。** `eval-net` 是 `--internal` 的 docker 网络，出网全靠边车代理（镜像里烧的 `HTTPS_PROXY=http://eval-proxy:8888`）。`eval-proxy` 停着的时候——它和 `eval-registry` 在守护进程重启后都是 `Exited (255)`——codex 在单元里正常起来、回读到自己的模型（`gpt-5.6-sol`）与沙箱档位、跑满 230 秒，然后 `task_complete` 的 `last_agent_message` 是 **null**。上面每一层都只能读成「探针失败」：先是 120 秒超时，再是 `stopReason: "error"`。没有任何一处说出「网络」两个字。每个探针白烧四分钟，而同样的四分钟会在这一轮的每一格上重演。

## 决定

- **run 自己开的那条会话，带上这次 run 的格子根。** `<stateRoot>/cells/<runId>`，在会话认领它之前先建出来（CLI 被丢进一个不存在的目录会死在 shell 里，早于那个本来会解释原因的 harness）。它是这次 run 马上要填的目录，活得与 run 一样长，也让 CI 起的 run 与人在实例里起的 run 从同一个地方开工。调用方给了 `cwd` 仍然它说了算，且**照单接受**——`/eval run` 传的是发起会话的工作区，那是已经存在的目录，不归我们创建。
- **自检由 plan 声明，编排器只拥有规则。** `unit.egressCheck = { command, timeoutMs? }` 经 `lab.verify` 在单元里跑：退出码 0 过，其余一律——非零退出、超时、`verify` 根本跑不起来——以 `EGRESS_UNAVAILABLE` 拒掉整个 run。命令与目标属于题库的装置，跟它们描述的那张网放在一起；把地址编进 eval，等于让它成为 plan 唯一改不动的那一部分。
- **在委派之前问，每一格再问一次。** 就绪探针的单元在 `acquire` 与那一轮之间问，所以出网断了**一次委派都不花**；每一格的单元在 `acquire` 与 `populate` 之间问——那是唯一的缝（容器建出来之后挂载改不了），也正好接住跑到一半死掉的边车，T29c 的单元就是这么变得够不着的。
- **`EGRESS_UNAVAILABLE` 是它自己的诊断码，不是 `READINESS_FAILED`。**「代理停了」与「这家认证不过」要找的是不同的人。就绪记录多一个 `infrastructure` 字段，同一个理由：受试对象根本没被问过，这件事与它无关。
- **不声明就是老行为，逐字节相同——但 run 说一次。** plan 有 `network` 却没声明时，日志里有一行点明这一轮分不清什么。声明了却等于没声明（`command: []`、含空词、非正数 timeout）则以 `EGRESS_CHECK_MALFORMED` 拒绝：契约子集没有基数关键字，run 这一层是唯一能挡的地方，而「以为自己被检查过」的 run 比「知道自己没被检查」更糟。
- **就绪默认值提到 420 秒。** 是实测不是拍脑袋：120 秒那个宿主路径的值会在容器探针**还在正常启动**时把它掐掉（冷启动 3.2GB 镜像加 CLI 的首次 `docker exec`），而被掐掉的探针读起来与「这家没登录」一模一样。`readinessTimeoutMs` 仍可收窄。

## 测试

- 同一份容器计划，两条起法的**就绪原文逐字相同**——job 那条压根没有发起会话，正是从前会被拒的形状——并钉住 job 开的会话拿到的是 run 的格子根。
- 出网拒绝端到端钉住：`EGRESS_UNAVAILABLE`、消息里带命令与它的 stderr、`agent.calls` 为空——一次委派都没花。
- 格子路径的动词顺序钉成 `acquire, verify, acquire, verify, populate`：探针的单元与格子的单元，各自在被用之前先被问。
- 有网络但没声明的计划只打一行提示，且 `verify` 调用次数为零（老形状原样）。
- `checkUnitEgress` 的四条失败分支（退出码、退回 stdout、超时、`verify` 抛错）与 `egressCheckOf` 的解析都有单测。
- 真机（3171，宿主 0.1.5-rc.1）：`/eval run` 起 job 把 P0 × codex 的容器格跑到 `released`；停掉 `eval-proxy` 再跑同一份计划，在自检处被拒且点名代理。

## 备选方案

**给容器轮传一个显式的宿主 `cwd`，让父会话的 cwd 无关紧要。** 否决：容器路径不传是**刻意**的——单元里宿主路径没有意义，把一个记到委派记录里，等于让记录对「这轮在哪跑的」说了假话。父会话需要一个工作区是 provider 的真实要求，修法是给它一个。

**把自检连同默认目标一起写进 eval。** 否决：评测网络的代理、镜像源与白名单是题库的装置。编排器里的默认地址只对一个实验室是对的，对其他所有实验室都是错的，而且它会成为环境里唯一一处 plan 改不动、又不进任何哈希的东西。

**从镜像自己的 `HTTPS_PROXY` 推出这条检查。** 有吸引力——不用声明——但它假定单元里有个能拿来探的工具，在没有的镜像里会**静默退化成空操作**。显式声明不会静默变成空操作。

**把失败当成某一个条件的就绪失败。** 否决：单元是每格一个，网络不是。一个单元够不着，下一个也够不着，所以拒掉整个 run 才是诚实的范围——而且不能让 `--ignore-readiness` 以「那个条件跳过就是了」把它放行。

## 后果

- CI 起的 run 能走容器路径了。Remote 这扇门与 `/eval run` 在 run 能观察到的范围内不再有差别。
- 内网上的计划应当声明 `unit.egressCheck`；不声明的照旧跑，日志里多一行说明这一轮分不清什么。
- `dataseek.plan/1` 多一个可选的 `unit.egressCheck`；协议 §6 的发布口径与两份 README 都跟上了。只有声明了它的计划，plan 哈希才变。
- 就绪默认值长了三倍半。真没登录的 harness 在容器路径上现在最多要 420 秒才说出口——这是不掐断诚实冷启动的代价。声明出来的出网自检，正是让常见的那种失败仍然很快的东西。
