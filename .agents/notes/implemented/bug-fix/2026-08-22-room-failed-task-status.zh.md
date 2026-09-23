# Agent Note: 成员 run 失败时任务落 failed 态

Status: implemented

[English](2026-08-22-room-failed-task-status.md) | 中文

## Problem

真机截图报来的问题：成员 run 失败时，自动开起的任务永远停在 `in_progress`——任务面板上那行一直转（"进行中 · 2 天前"），任务胶囊也持续扫光，而唯一的失败信号只是聊天流里那条 dim 的 failed 行。引擎 settle 的注释写着"a failed run leaves the task for the human"，但它留下的是一条与仍在工作的任务无从区分的行：两个表面对不上，任务板在说谎。

## Decision

任务板新增第五个状态 `failed`（`RoomTaskStatus`、`room/task-updated` 线上事件、客户端 node fold 三处同步）。settle 关任务的循环现在把该成员打开的 `in_progress` 任务关到 run 自身的终态——完成即 `done`、中断即 `cancelled`、失败即 `failed`——不再只处理前两者。failed 任务对引擎而言是终态，但仍可被人处置：它不算 `task-closed`，`closeTask` 仍然接受它。任务板上的 failed 行渲染实心 error 色 × 图标与"失败"/"failed"标签，并给 [关闭] 按钮把它推进到 `cancelled`——绝不给 [完成]，因为没跑完的 run 不能计入目标进度；重新派发走新的 @ 消息，不是任务板动作。派生视图把失败排除在"活跃"之外：胶囊的未结计数仍是 pending+in_progress，runners（也就是扫光）只统计 `in_progress`，`taskProgress` 把 `failed` 与 `cancelled` 一样移出分母（失败的任务从未推进过目标）。旧 journal 不动——修复前滞留 `in_progress` 的任务按原样回放，手工关闭即可。

## Alternatives considered

- **任务保持 in_progress、失败只在聊天行里体现**——否决：这正是 bug；任务板是协作表面，永远转圈的行读作"正在干活"。
- **失败 run 的任务自动关为 cancelled**——否决：它把失败信号从任务板上抹掉（cancelled 读作"从没算进计划"），人应该先看到 run 失败了再处置。
- **failed 行给 [完成]**——否决：它会让失败任务计入目标进度，污染 `taskProgress`；关为 `cancelled` 的语义才对（"拿下任务板，而非完成"）。
- **折叠胶囊上加一个失败计数**——暂不采纳：胶囊词汇保持不变（未结计数 + runners）；failed 行留在面板上可见，那才是人处置它的地方。

## Consequences

- `room/task-updated` 线上事件的 status 联合变宽；任何第三方对该事件的 fold 都必须容忍 `failed`（journal fold 本就透传状态）。
- host 规格双向钉住：失败 settle 把自动开起的任务关为 `failed`（主 agent 无 live agent 与门面中途消失两条路径），且 `failed` 任务可经 `closeTask` 关为 `cancelled`、再次关闭按 `task-closed` 拒绝。`taskProgress` 把 `failed` 移出分母。客户端规格钉住 failed 行的图标/标签/[关闭]，以及胶囊对 failed 任务的无感。
- 已在 scratch 实例（3199 端口）真机验证：向一个 provider 未注册的成员新派一次任务，run 失败，新任务落 `failed`、红 × 图标加 [关闭]，胶囊无扫光无计数，点 [关闭] 后该行变 `cancelled`（截图在那台本机实例的 `scratch-screenshots/` 里，git 忽略、未入库）。
