# Agent Note: 外部 agent 子会话日志对 Context Lens 的数据契约

Status: implemented

## Problem

Context Lens 以外部 agent 子会话日志和 room 运行事件为数据源，提出四个缺口:

1. **缓存字段的 0 与缺省**:claude-code 日志有 `cacheWriteTokens` 但 `cacheReadTokens` 为 0 时不写——读方分不清「命中 0」与「没上报」。codex 日志只有输入/输出——但 codex 的映射本就存在，那些轮次上游确实是 `cached_input_tokens: 0`,`> 0` 门把 0 丢了。codex 还从不映射它的 cache-write 计数。
2. **一个 codex 子会话丢了回复**（一轮完成的轮次没有 assistant/message；之后一轮完成的运行整轮没写）。
3. **room 与子会话无关联**:`room/run-state` 只在有时带 `childSessionId`（成员首跑从不带），也没有任何字段说明一次运行对应子会话的哪一轮。
4. **未记录的读取接口**:lens 把四个 room 事件当关联接口读，但没有任何成文契约。

## Decision

- **上游带缓存字段时 `cacheReadTokens` 恒写，0 也写**——kimi(`usageFromWire`)、claude(`usageFromClaude`)、codex(`usageFromCodex` + `usageFromAppServer`）同一规则，「命中 0」不再读作「没上报」。codex 另外把它的 cache-write 计数（`cache_write_input_tokens` / `cacheWriteInputTokens`）映射到 `cacheWriteTokens`（此前丢弃）。
- **codex 的「丢回复」不是现行代码的缺陷。** 受损会话跑在 `62411daa` 之前的 live 镜像上（该 commit 修的 step 顺序 bug)，坏括号使日志不可读；之后一次手工截断修复从首个非法事件起砍掉了一切，第 2 轮的完成折叠与第 3 轮随之消失。现行代码不存在「完成的轮次整轮不写」的路径：补了该精确形态的回归测试（续轮中流式中止后，半截回复以 interrupted 消息落盘），并硬化评审发现的真实残余风险——`turn/completed` 折叠失败会跳过 `resolveCompletion` 让轮挂起——改为 try/finally 保证收尾。
- **room/run-state 携带关联**:`childSessionId` 在身份存在后的所有边恒带（running 边改为重读名册而非旧的捕获快照；成员首跑的 running 边仍早于句柄——终态边与 journal 回填兜住），终态边加 `childTurn`（子会话最后一条 turn/start 的轮次号，只读在内存的存活会话）。lens 读取的四个事件（`room/dispatch`、`room/run-state`、`room/coordinator`、`room/member-added`）在 SessionEventMap 注册处标注了同步义务注释。

## Alternatives considered

- **codex 每轮只记最后一次 API 调用的用量**（多调用轮少计；rollout 有 `total_token_usage` 可做差分记账）。记为已知缺口、本轮不改：它改变已记录用量的语义，值得与 lens 单独定口径。
- **把 running 边推迟到句柄产生后写**。running 边的本职是标记准入；lens 要的关联由终态边的 `childSessionId` + `childTurn` 回答，journal 也回填执行记录。
- **以 runId 为键的独立关联事件**，而不是在 run-state 上加字段。给现有边加 optional 字段更便宜且回放兼容；旧日志回放时字段缺席。

## Consequences

- 新日志全家族可区分 0 命中与未上报；codex 的 cache-write 花费不再不可见。
- lens 不用按时间猜就能把 room 运行对应到子会话轮次；旧日志回放不变（字段皆 optional)。
- codex 的剩余已知缺口（留给其 owner)：每轮只记最后一次 API 调用（见 Alternatives)，以及 exec 路 usage 载体竞态（载体行先于 `turn.completed` 镜像则本轮 usage 丢失，仅 warn)——目前都是 warn 级。
- 撞车备忘：room 的 `types.ts`/`dispatch.ts` 有在途分支（room-local-agent-host021 今天在重写 admitted/settle 的同一批 hunk，且把 `room/coordinator` 的 `previousMemberId` 改成可选——lens 读那个事件）。本次改动是纯加 optional 字段；文本上与该分支冲突，合并顺序由协调者定。

## Testing

claude-code 262 + codex 250 + kimi 284 + room 333，全绿。新增覆盖：claude 的零命中/写字段契约、codex 的 cache-write 映射 + 恒写 cacheRead + 中止续轮回归、room 的 run-state 边携带 childSessionId（新成员首跑 running 边诚实缺省）+ 终态边带 childTurn。
