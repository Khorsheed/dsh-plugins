# Agent Note: 释放闸是 run 本来就做的事，不是给它的一个旗标（I5 · T57）

Status: implemented

[English](2026-09-16-eval-run-release-gate-default.md) | 中文

## Problem

三条发现，底下是同一个机制。

**T33b 补充二。** 不带 `--finalize` 的容器 run 每格停在 `archived`，而停在 `archived` 的格子没过释放闸，于是容器留着。第三格占掉第三个名额，第四次 `acquire` 撞上 lab 的 `maxConcurrentUnits`（4）被拒。格子数超过这个上限的计划必然跑不完——也就是说，**跑循环的缺省在悄悄决定矩阵能有多大**，而它选的数是四。

**T39 · G10。** 计划审阅页的「批准并启动」只有一个按钮、没有第二个选项。跑循环缺省是什么，每一次批准就是什么，而那一页上没有任何一句话说它是什么。

**T39 · G18。** 走查那次 `finalize` 之后，两个容器还 `Up` 着。界面上没有任何提示，是靠敲 `docker ps` 发现的。原因比疏忽更糟：`finalizeRun` 只动账本，**只**动账本，它从来不调 `lab.release`。而 `isReleasable` 读的是当前状态对模板的 `releasableStates`，那里只有 `releasable` 一个——被 finalize 推到 `released` 的格子，已经越过了任何闸会放行销毁的唯一状态。那两个容器，当时存在的每一条不 force 的路都收不回来。

旗标从来不是重点。`--finalize` 是 v0 时代引入的：那时没有判官，填不满归档闸要的非空 `verdicts/`，停在 `archived` 是当时唯一诚实的缺省。自 T9 起每格归档前都先判，闸通常答是，于是旧缺省早就不再意味着「我们过不了闸」，而是意味着「我们把每个容器都留着」。

## Decision

**过闸是 run 本来就做的事。** 每格跑完当场走 `archived → releasable → released`，单元在两次 transition 之间销毁。闸本身一点没变：`verdicts/` 为空照样拒，拒绝照样按格记 `{kind: 'finalize-refused'}`，什么都不强推。正因如此，把它定为缺省才敢说得这么直白——它不可能释放任何「显式问过时闸会拒绝」的东西。

**`--keep-units` 是回去的路。** CLI 旗标与批准对话框的「保留单元」勾选（缺省不勾）要的是旧行为：每格停在 `archived`，容器留着给人打开。`RunOptions` 同时带 `finalize` 与 `keepUnits`，在 `runPlan` 里**一个地方**收成一个布尔；两个都给时 `keepUnits` 赢——它是更具体的那个要求。`finalize: false` 仍然能跨线上用，CI 调用方不必知道新词也能要回旧形状；`--finalize` 在两个面上仍被接受，含义就是缺省已经在做的事。

**`finalize` 回收容器。** 这条路现在接一个可选的单元面，在跑循环销毁的同一个位置销毁每个过闸格子的单元。这才让 `finalize` 成为真正的再入口，而不是一次账本编辑：回收一个容器**就是**它那格过闸。这个面之所以可选，是因为确实有一个调用方没有 lab——`dsh-eval finalize` 是以子进程调 `dsh-mission` CLI 的——那个调用方把单元名单报成**未知**，绝不报 `0`。

**销毁失败绝不把格子卡在半路。** 闸答是之后 `lab.release` 抛错，这条路记下 `{kind: 'unit-retained'}` 并**继续走到 `released`**。另一种做法比漏一个容器更糟：`releasable` 不是 finalize 会处理的状态，停在那里的格子会被此后每一次走当成 `interrupted` 跳过，再也动不了。

**报告页数出 lab 持有多少。** 新读动词 `runUnits(runId)` 返回 lab 自己的名单（按本 run 过滤），与每格的账本状态 join。页顶显示计数，大于零时给一个「回收」——它调的还是 `finalize`，不是第二条路——下面一节逐个列容器与那格的状态，因为正是这个状态说明「回收」还收不收得动（`archived`），还是只剩 `dsh-lab release --force`（`released`，人的决定）。

**被拒的 acquire 点名占位者。** lab 只说「先释放一个」，不说是哪个。`run.ts` 包住两处 `acquire`，**仅在** `maxConcurrentUnits` 被拒时补上每个占着名额的单元的 run id、单元 id、容器名与格子，外加能结束它们的两条命令。

### 为什么计数来自 lab 而不是 mission

mission 早就有 `runStatus().unreleased`：refs 说自己持有资源的那些格子。那是账本的**判断**。这一页存在的理由恰恰是两者不一致的那种情形——账本已经 released、容器却还 Up 着，正是 G18 的形状。按账本推出来的计数，会对那两个真在跑的容器报 `0`。

`available: false`（没挂 lab，或 lab 问不到）渲染成「未知」而不是 `0`，理由相同：一个从没去看过的东西给出笃定的零，正是持有的容器藏起来的方式。

### 补名单这件事归谁

点名占位者是编排器的活，不是 lab 的。lab 不知道什么叫一次 run，把这套词汇给它，等于挪错了边界的那一半。代价是一条浅缝：`run.ts` 按 lab 自己的措辞（`/maxconcurrentunits/i`）判断要不要补。lab 哪天改了措辞，补充就不再发生，原始消息照样到读者手上——是降级，不是断裂。另一种做法是跨包传一个有类型的错误，那是对一个本任务划定不碰的包做契约变更。

## Alternatives considered

**保持 `--finalize` 是可选的，只修上限。** 让 acquire 排队，或者把 `maxConcurrentUnits` 调大。两种都把上限当成问题。上限是安全阀，它在尽职；错的是一个跑完的格子还占着一个它再也用不上的容器。把数字调大，只是把墙从四格挪到八格。

**只留 `keepUnits`，从选项里删掉 `finalize`。** 表面更干净，但 `EvalRunRequest.finalize` 是线上字段，CI 调用方可能已经在发；`--finalize` 也出现在存下来的命令和走查日志里。两个都留、在一个地方收拢、把优先级写下来——成本是一行解析，谁都不坏。

**给「回收」一个自己的动词。** 一个「释放本 run 的容器」的调用，绕开账本，实现起来更简单，而它正是这条缝拒绝的那种 force：一个不过闸就能到达的销毁，会让「归档」这两个字失去意义。一个动词、两个标签，因为读者的**意图**不同，机制并不。

**格子已经 `released` 时强制回收。** 这能一键关掉 3171 上 G18 那两个容器。它同时为一个「上游修复已经不会再让它复发」的问题，造了一条绕过闸的永久路：这次改完之后，被 finalize 的格子，容器是在那次走**过程中**销毁的，所以一个格子既过了闸、容器又还在，只可能是销毁本身失败了——那是记录在案、点了名、且罕见的。剩下那一步仍归人，页面把命令原样打出来。

**把 `finalize` 放宽到也处理 `releasable` 的格子。** 这样销毁失败可以由第二次走重试。它同时改变了 `skipCategoryOf` 的含义和「`interrupted` 的格子」是什么，而那种情形有更清楚的答案（`--force`，由一个已经看过那个容器的人来做）。不动。

## Consequences

**容器 run 不再被 lab 的上限卡住。** 无论矩阵多大，run 同时只持有一个单元，因为每格的容器在那格过闸时就死了。这就是全部目的，也正是 pilot B 三格那轮需要的。

**现在每次缺省 run 都会问闸，于是没有判定来源的 run 会逐格写一条 `finalize-refused` 注解。** 在宿主路径上——那里根本没有容器可回收——这条注解是唯一看得见的变化：一个没有探针也没有判官的计划，原先一格不记，现在每格记一条拒绝。它是诚实的（run 问了、闸答否、原因在格子上），也正是「拒绝照记不强制」的含义；但对一个本来就不可能过闸的 run 来说，这是账本里新增的噪声。

**run 留下了什么，现在是界面承载的事实。** 在此之前，「容器没了吗」只能靠在实例上敲 `docker ps` 回答。代价是每次访问报告页多一次 Remote 读，而这次读会从一张原本只是「导出 bundle 的投影」的页面上碰到活的 daemon——这正是它做成独立动词、独立 effect，而不是报告里一个字段的原因。

**格子已经 `released` 的容器仍然需要人。** 这次修复让这种状态不再产生（销毁现在发生在走闸过程中），但用旧版本 finalize 过的 run、或者在 provider 那头失败的销毁，还是会落到那里。页面和这条路都会点名它并打出确切的 `--force` 命令；两者都不会替人敲下去。

**`maxConcurrentUnits` 的补充是对另一个包措辞的字符串匹配。** lab 改了措辞它就降级成原始拒绝，而且降级时不会有任何响动。这是「不碰 lab」的代价，可接受；哪天这条缝比现在更要紧，升级路径是一个有类型的拒绝。

## What changed

- `packages/eval/src/run.ts`：`RunOptions.keepUnits`；`finalize` 文档改为缺省为真；一处 `passGate` 收拢；记 `run.meta.finalize`，让 bundle 能分辨「被要求停在 archived」与「跑断了」；`acquireUnit` / `describeUnitHolders` 与两处 acquire 调用点。
- `packages/eval/src/finalize.ts`：`FinalizeUnitsFace`、两次 transition 之间的 `releaseCellUnit`、`heldUnitsOf` / `heldReasonOf`，以及报告上的 `unitsReleased` / `unitsHeld` / `unitsKnown`。
- `packages/eval/src/service.ts`：`finalize` 在挂了 lab 时把它接上；`runUnits(runId)`；`approve` 带上 `keepUnits`。
- `packages/eval/src/remote.ts`：`runUnits`；`runStart` 与 `approve` 带上这个开关。
- `packages/eval/src/slash.ts`、`src/cli-core.ts`：`--keep-units`、`--finalize` 作为缺省被接受、容器那几句重写，以及 CLI 的 finalize 每次都说明它没碰任何容器。
- `packages/eval/src/client/`：契约上的 `fetchRunUnits`、store 字段、报告页的单元条 / 单元节 / 回收、计划审阅页的「保留单元」勾选，以及两种语言的词条。
- `packages/eval/src/types.ts`、`src/faces.ts`、`src/report-view.ts`：线上形状、`LabUnitRow`、投影。

## Testing

- `packages/eval`：705 个测试全绿（此前 681）。
- `tests/run.spec.ts` —— 在一个会执行真实上限的 `FakeLab` 上跑三格容器 run：**一个旗标都不给**时三格全部 `released`，`peakLive` 是 **1**，唯一一次 force 释放是就绪探针的；`--keep-units` 时三格全停 `archived`、三个容器都在；上限设为 1 时被拒的 acquire 点名占位的 run、`u1 (dsh-lab-u1, cell …)` 与两条命令。另有 `keepUnits` 压过显式 `finalize: true`，以及两种情况下的 `run.meta.finalize`。
- `tests/finalize.spec.ts` —— 销毁落在两次 transition **之间**（假 lab 的闸在 `archived` 和 `released` 都拒绝，所以顺序本身就是断言）；被闸拒的格子留着容器并点名闸是原因；已经 `released` 的格子报成人的决定且**不**强推；销毁失败时格子停在 `released` 并带 `unit-retained`，而不是卡在 `releasable`；别的 run 的单元不碰；没有面与 lab 问不到都报 `unitsKnown: false`。
- `tests/report-face.spec.ts` —— `runUnits` 按 run 过滤并 join 每格状态；没挂 lab 与 lab 问不到都答 `available: false` 并给出原因。
- `tests/Report.client.spec.tsx` —— 计数、逐个容器与其格子状态的列表、「回收」先问一次再落到同一个 `finalizeRun` 调用、无占用时不给按钮、没挂 lab 时显示「未知」（绝不是 `0`）。
- `tests/LabReview.client.spec.tsx` —— 「保留单元」缺省不勾，勾了就带进 `approvePlan`。
- `tests/slash.spec.ts`、`tests/remote.spec.ts` —— 开关穿过两个面、`--finalize` 仍被接受，以及 CLI 那一面的 finalize 说明容器没被碰过。
