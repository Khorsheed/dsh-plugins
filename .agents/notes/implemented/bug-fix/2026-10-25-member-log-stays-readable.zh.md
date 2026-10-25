# Agent Note: a member's child log stays readable across restarts and cancels

Status: implemented

## Problem

Context Lens 对一个 Claude Code 成员（会话 2377f26d…）报 `stored log is corrupt: SessionFormatError: turn/start does not open the expected turn`。聊天界面看起来正常，是因为它显示的是内存里的会话；磁盘上的日志已经无法通过严格读取器，下次重启时这个成员也会重新挂载失败。扫描最近两天写过的日志，共发现三份这样的日志：

- **2377f26d（claude，重启）。** 3080 在第 9 轮进行中重启。重新挂载时，冷日志停在第 9 轮中间，下一轮没有先关上它就写了 `turn/start {turn: 10}`。agent loop 自己恢复时会用 `interruptedTurnClosers` 关上被打断的末尾，而 local-agent 的重新挂载（`LocalAgentRegistry`，所有 CLI 成员都走这条路径）一直没有这一步。
- **5dd078d9（claude，取消）。** 上级取消了第 7 轮，`turn/end` 已经写入。这一轮的事件接收器要等迟到的 `result` 到达后才卸下，在这段时间里，CLI 的 `[Request interrupted by user]` 提示被镜像成了第 7 轮结束之后的一个新步骤。
- **bf220f56（kimi）。** 步骤号从 1 跳到 3，是 b1d0d972 修复之前写下的旧日志。

## Decision

- **重新挂载时关上被打断的末尾**（`packages/local-agent/src/index.ts`）：冷读之后，把宿主 `interruptedTurnClosers` 生成的事件（缺失的工具错误、step/end、`interrupted` 的 turn/end）经写入句柄追加并放进种子，顺序与 agent loop 完全一致。这个函数从模块命名空间上读取，没有它的宿主保持原有行为。文档里的重新挂载示例也加上了同一步。
- **Claude 的一轮收尾后不再写入任何内容**（`packages/local-agent-claude-code/src/live-driver.ts`）：收尾后，接收器只处理迟到的 `result`，其他事件一律丢弃。
- **已有的三份日志** 用脚本离线修复，只在 3080 停止时运行（打开中的写入句柄自己记着序号）。脚本会补上缺失的 `turn/end`（放在重启的 end-seed 标记之前）、删除已结束轮次的迟到事件、把步骤号改成连续、重新分配连续的序号并同步引用，再用宿主的严格读取器校验，并保留备份。

## Alternatives considered

- **在每个提供方写 `turn/start` 之前关上未结束的轮次。** 这涉及五个包里的十处调用，而重启的情况走的是同一条共享路径。
- **让 Context Lens 用宽松读取器。** 聊天自己的重新挂载也会在同一份日志上失败，所以日志本身必须合法。

## Consequences

- 被重启打断的成员，这一轮显示为中断，日志保持可读。
- Codex、kimi 和 dsh 的常驻驱动可能也有收尾后写入的问题；扫描的日志里没有观察到，这次没有改。

## Testing

- `local-agent`（405）：日志停在未结束步骤中间时，重新挂载会补上 step/end 和 interrupted 的 turn/end，并写入磁盘。
- `local-agent-claude-code`（269）：取消之后，迟到的中断提示、迟到的助手文字和迟到的 result 都不会再往已关闭的日志里添加内容。
- 三份日志修复后的副本都通过了宿主的严格恢复；原文件能复现报告中的错误。
