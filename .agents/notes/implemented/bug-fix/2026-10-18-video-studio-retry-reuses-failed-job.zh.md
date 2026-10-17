# Agent Note: video-studio —— 重试失败任务复用原行

Status: implemented

## Problem

重试失败的转写任务时，每点一次就新叠一行：`retryTranscribe` 走 `enqueue`，而它只对 `queued` 状态去重，于是一个失败任务加重试两次就在工程任务列表里渲染出三张相同的失败卡片。

## Decision

`enqueue` 现在把「同工程、同类型、同 payload 的 `failed` 任务」视为正要入队的那个任务本身：把该记录重置为 `queued`（进度归零、清错误、刷新 label、更新 `updatedAt`）并触发 pump，而不是追加新行。重试按钮和首次失败后的自动转写路径都走这里；已取消的任务（状态 `failed`、错误为已取消）重试同样原位复活。任务是任务状态而不是审计日志——被取代的失败行里除了错误信息没有值得保留的，而重试本身就是对那条信息的回应。

## Alternatives considered

- **只在 UI 层折叠重复**：否决——噪音仍会在 `jobs.json` 里持续累积。
- **保留历史，把旧行标记为已取代**：否决——没有任何界面读这段历史；每个待办意图一行才是 UI 本来暗示的模型。

## Consequences

- 任务列表每个意图只占一行；重试开始时旧的错误信息消失（彼时它已过期）。
- 重试后任务的 `createdAt` 不变（行位置保持）,`updatedAt` 反映重试时间。

## Testing

`tests/core.spec.ts` 预置一个失败的导出任务，断言重新入队返回同一 id 且 jobs 文件仍只有一条记录。包测试全绿 29/29。
