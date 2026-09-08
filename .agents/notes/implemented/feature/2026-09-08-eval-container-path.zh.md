# Agent Note: 评测 run 循环一格一个 lab 单元

Status: implemented

[English](2026-09-08-eval-container-path.md) | 中文

## Problem

run 循环至今是「阶段一二、宿主目录」：每格一个 `$DSH_HOME/state/eval` 下的目录，题面逐文件物化、编排器自算清单，委派只给 `cwd`，探针在宿主 `execFile`，归档是 `cpSync`。这场比较赖以成立的每一项隔离——封闭网络、pin 死的镜像、各家凭证的边界、资源上限——都只存在于环境层，而没有任何一次 run 真的跑在里面。

I3 的三块前置都已在 main：委派可以点名容器（`exec: {container, workdir, env}`，T17）；单元可以带网络、user、资源上限与挂载被取走，全部进一个复合指纹（T18b）；探针运行器把两个 verify 层物化好并给出三态退出码（T28）。缺的是把它们排成一条顺序的那段编排。

有一条后果是可量的而不是理论的：架构四条不变量的第二条「环境一致」，在整个 pilot A 上都是 `unverifiable`——`refs.fingerprint` 没有写入方。

## Decision

- **开关在数据里，不在旗标里。** `dataseek.plan/1` 长出可选的 `unit` 段（`image`，以及可选的 `network` / `user` / `resources`）。在场，本 run 每一格都在一个 lab 单元里跑；缺省，走宿主路径，逐字节与从前相同。`dataseek.condition/1` 长出可选的 `unit.scopedHome`（`container`、`var`）——这个受试对象的凭证目录挂到容器内哪里、由哪个变量指向它——且 `var` 必须同时出现在 `env.keys` 里：注入的名字要是被审阅文档承认会注入的名字。契约记 v1-rev6。
- **凭证的宿主一侧是运维事实，不是被审阅的事实。** plan 与 condition 都不带宿主路径；run 拿到 `--creds-root DIR`，取 `<DIR>/<条件 id>`，同一对数据文件换台机器照跑。编排器只检查目录存在、非空、属主是单元的 uid 或它自己的 uid，绝不打开里面任何一个文件。两个可接受的属主是**一条规则**而不是平台分支：Linux 宿主 uid 直通，Docker Desktop 把 bind 挂载重映射到容器用户，而第三个 uid 恰恰是单元读不到、也写不回自己凭证的那种情形。
- **一格一单元，顺序就是轨迹表第 11 步起早就写好的那条。** acquire（一条挂载、一条 env、带 mission 与 run id）→ populate（宿主物化目录 → `/workspace`，清单由 lab 写）→ 每阶段：一轮带 exec 目标、**不带 `cwd`** 的委派，然后 `checkpoint(name: 阶段 id)`，然后 `collect` 回宿主镜像 → 探针经 `lab.verify` → archive → release。
- **`refs.fingerprint` 由编排器写，acquire 之后立刻。** lab 自己也写这两条 ref，但那次登记按设计是 warn-and-skip，而一条不变量不能建在允许跳过的写上。
- **探针在哪里跑，是一个接口两种实现。** `ProbeExecutor` 有 `run` / `collect` / `outFile` / `discard`；宿主执行器就是原来的 `execFile` 路径，一字未改；单元执行器把判定目录作为材料交给 `lab.verify`，把探针指向 `/workspace`。三态退出码、verdict 契约、先回填后校验的顺序都是共用代码——两条路径之间要比的东西，不该是判定本身。
- **判定产物不进工作区。** `--out` 写到 `/run/dsh-lab/verdicts/<探针>/`，最后一个探针跑完由一次 `collect` 把整棵树收回该 attempt 的运行数据。归档是选手的产物；一棵 verdict 树进去，就会永远留在每一个 bundle 里。
- **销毁路径唯一，且在闸说「是」的那一刻执行。** `run.ts` 只有一个 `destroyUnit`，`lab.release` 不在别处出现。带 `--finalize` 时，销毁夹在 `archived → releasable` 与 `releasable → released` 之间：`isReleasable` 读的是**当前**状态、模板的 `releasableStates` 只有 `releasable`，所以走到 `released` 再销毁会问出一个闸必然答否的问题，每个容器都会活下来。闸拒绝时——没有 `--finalize`，或 `verdicts/` 为空——照样问、照样被拒，**容器留着**，格子上记一条 `{kind: 'unit-retained', reason}`。异常路径是 `collect` → `archive` → 同一条闸：不归档就 release 等于毁掉崩溃现场。
- **`force` 只出现一次**：就绪检查的探活单元。开跑前的检查搬进了一个与格子同规格的单元里，因为一份在宿主上答「已认证」的凭证，对「bind 挂进封闭容器之后还能不能用」什么都没证明——那正是 pilot A 的 G4 上升一层。该单元不绑 mission，因而没有闸；lab 对这种销毁要求显式 `force`，正是为了让「无闸销毁」是一句判决而不是一个默认。
- **串行。** 容器路径固定 `concurrency: 1`，显式给 `>1` 是拒绝而不是静默改写；`acquire` 撞上 `maxConcurrentUnits` 是要报出来的缺陷，不是要排的队。并发单元归 I4。
- **lab 改了三处，都是容器路径不改就跑不起来的。** 一处新增：`AcquireSpec.ownWorkdir`——`docker run --workdir X` 把缺失的 X 建成 `root:root`，于是声明了非 root `user` 的单元写不进它整个工作生涯所在的那个目录；`populate` 还照样成功（拷贝走 daemon，是 root），**第一次从单元内写**才失败。两处修复：`acquire` 现在把 scratch 根 `/run/dsh-lab` 也置为可写，而不只是 `/run/dsh-lab/pids`——否则非 root 单元上的 `verify` 死在它自己的 `mkdir` 上；`verify` 把拷进去的材料交给单元的用户——否则它自己的 `rm -rf` 会逐个文件失败，答案键留在单元里直到容器被销毁。两处都不改动词语义：它们只是让写在文档里的行为，在本项目实际会跑的那种单元上真的发生。

## Real-machine verification

真的 docker daemon，真的 `LabService` / `DockerProvider` / `MissionService` / datasets 服务，真的题库仓库（`i3-probes`），T16 冻结的镜像（`eval-env:pinned`，`sha256:ed988b33…`），`eval-net`，user `1000`，`cpus: 2, memory: 4g`。P0-placeholder × 一个 codex 形状的条件，跑两次，每次一格：

| | run 1（不带 `--finalize`） | run 2（带 `--finalize`） |
|---|---|---|
| 就绪检查 | 探活单元 acquire，`force` 释放 | 同上 |
| 单元 | `dsh-lab-19da99b0`，`lab-env:5787bf0707fd…` | `dsh-lab-4f8fd1e0`，同一指纹 |
| 阶段 | 2 轮，都点名单元（`workdir /workspace`，无 `cwd`），checkpoint `aec844e32cfe` / `0aaa9e255872` | `5489091a1523` / `29e97e451a71` |
| 探针 | `shared/helpers/probes/no-patch.sh`，`where: unit`，退出 0，`judged`，1 条判定 | 同上，1 条判定 |
| 闸 | `archived`；release 被拒（`not in a releasable state`）；容器仍在；记 `unit-retained` | `releasable` → released；容器已删 |
| `lab status` | `taskHash 1c9767b3`，与 mission 清单的 `sha` 一致 | — |

归档里有 `workspace/` + `verdicts/script.json` + `manifest.json`；`probe-verdicts/` 在该 attempt 的运行数据里与之并列；留下的那个容器里 `/run/dsh-lab` 只剩 `pids/`，`/workspace` 里是选手产出与物化好的题面，没有清单、没有判定。对 released 的 bundle 跑 `dsh-eval report`，四条不变量是 **题面一致 ✅ / 环境一致 ✅ / 受试对象一致 ⚠️ / 程序一致 ✅**——第二条在整个 pilot A 上都是 `unverifiable`，这是它第一次成立的一次 run。

宿主路径是复算过的，不是假定的：本分支上对 pilot A 的 bundle 跑 `dsh-eval report`，`results.jsonl` 逐字节一致，`summary.md` 只差 bundle 路径、生成时间，以及 T24 在那份 summary 写成之后加的一节。

本驱动**没有**做的一件事：在单元里跑一次真的 CLI。委派面是从容器内部（`docker exec`）写出每阶段产出，而不是在那里拉起 codex。那条传输是 T17 在同一个镜像上实测过的接缝，本次改的只是这一轮带哪个选项，而那一点由测试在参数层钉住。本次没有备任何凭证：挂载的目录里是一个占位文件——一次根本走不到 CLI 的 run，没有理由持有真凭证。

## Alternatives considered

**让 lab 自己的登记去写指纹。** 拒绝：`registerRefs` 失败时按设计 warn-and-skip，而本任务的全部意义就是让一条一直空着的不变量不再空着。编排器写，lab 再写一遍无害。

**容器路径也由编排器自算物化清单，与宿主路径一致。** 拒绝：`populate` 本来就对它拷贝的那棵树算了哈希，而两个同名 `materialization.json` 带两个不同哈希，比任一个单独存在都糟。代价是真的、也记下来了：两条路径的算法不同（`path\0sha\0` 对 `path  sha`），因此数字在同一 run 内可比、跨路径不可比。不变量问的从来只是 run 内那个问题，报告两种字段名都读。

**把阶段间的 `collect` 登记成 workspace 产物。** 拒绝：mission 的导出会整体拷贝 attempt 的数据目录，于是登记 workspace 等于让每个 bundle 里每格的工作区多存一份，就挨着已经有一份的归档。改为登记一行 `workspace-mirror.json`，它说明镜像在哪——那才是排查一格时真正想要的东西。

**每个探针跑完就收它的判定。** 拒绝：那是一格里每个探针一件产物，而 `lab.collect` 无条件登记。全部跑完再收一次，代价只是在内存列表上多走一遍。

**格子到 `released` 之后再销毁单元。** 实测否掉：`isReleasable` 读的是当前状态，`releasableStates` 只有 `releasable`，那样每一次 run 的每一个容器都会活下来。销毁因此夹在两次转移之间。

**不带 `--finalize` 就拒绝容器 run。** 拒绝：停在 `archived` 是一个正当诉求，拒绝它等于取消「先看看再释放」这条工作流。改为开跑之前就明说：本 run 每一格的单元都会活下来。

**把工作区声明成 bind 挂载，而不是 populate 进去。** 拒绝：挂载在 acquire 时声明并进指纹，而一个宿主属主的工作区等于把编排器的文件系统放进单元。populate 进可写层正是架构第 12 步写的做法，也正是物化清单成为**证据**而不是描述的原因。

**给 `verify` 加一个 `keep` 列表，让它的清理绕开 verdicts 目录。** 不需要：lab 的清理只删 `/run/dsh-lab/verify`，而 verdicts 在它的兄弟目录里。加了会是一个没人问过的问题的答案。

## Consequences

- 四条不变量里，只剩一条本循环自己立不住：「受试对象一致」仍需模型回读，那是 provider 的事。
- **多家横比时指纹不同。** 复合指纹含 env 键名，而每家的作用域目录变量不同，于是四家跑同一个 run 时「环境一致」按既有规则记 `violated`。这是如实的——四个环境确实不同——但也意味着这条不变量按现在的写法，对整个 profile 存在的理由（那场比较）恰恰不成立。要解决得动指纹分量或报告口径，属 I4，不该在这里悄悄改掉。
- 失败的格子会留着容器直到有人看它。这是销毁路径唯一的既定取舍，并且与 `maxConcurrentUnits` 相互作用：反复失败的 run 会撞上限，那会作为缺陷报出来而不是排队。
- 给既有条件补 `unit` 会改哈希、让 lock 过期——那是一次重新 provision，不是一次编辑。
- lab 的 `verify` 现在把材料交给单元的用户，于是探针可以在自己旁边写文件。没有东西依赖这一点；它是让清理能真的清理掉的副产物。
