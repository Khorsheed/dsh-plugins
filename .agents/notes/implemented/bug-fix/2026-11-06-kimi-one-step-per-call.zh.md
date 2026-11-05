# Agent Note: Kimi live 每次模型调用写一步；Context Lens 把旧日志里拆出来的步读成镜像批注

Status: implemented

## Problem

Kimi live 成员的子会话日志把一次模型调用写成了同一时刻的两步。成员 `c937f309` 第 6 轮里，步 166 是一条只有思考块的 `assistant/message`，没有用量，`stream` 为空；步 167 才是带用量和 stream 的 Edit 调用。这份日志里共有 51 个这样的纯思考步，kimi home 的 `usage-diag.jsonl` 把 51 个都记为 `finalize-from-live`，途径是 `gap`。原因在 live 驱动的补洞（`finalizeBefore`）：折叠要写到某条实时流预留步之上时，会先把那条流单独封成一个持久步。调用 C 的思考开始流式输出时，调用 B 那个只有工具的 wire 步还没折叠（B 没有思考，没有流与它配对）。等 B 折叠时，C 的思考被封在 B 前面；C 自己折叠时又把这段已封存的思考排除在外。结果这段思考既放错了位置，又单独占了一步。

[S8](../simplification/2026-11-05-context-lens-reads-execution-records.zh.md) 之前，Context Lens 会把这种没有用量的步拼进下一次请求。S8 对带执行记录的日志关掉了拼接，于是成员的 Context Lens 把拆出来的步显示成一次独立请求（「#348 · 思考」，token「—」）。这次请求的缓存断点也是拿下一次请求的内容算的：store 按开始时间为请求选对比基线，而拆出来的步的开始时间取自下一次调用的历史流。

## Decision

**Kimi live：以 wire 步为调用边界**，做法与[批 3](../simplification/2026-11-02-local-agent-shared-mirror-writer.zh.md) 之后的 Claude live、[S3](../feature/2026-11-04-codex-live-one-step-per-call.zh.md) 之后的 codex live 一致。`session-mirror.ts` 原本就把同一 wire 步的思考行、文本行、工具行归成一个单元。现在每次折叠把这个单元写成一步，步号按写入顺序取（`nextWrittenKimiStep`），经 `appendMirrorStep` 写入，单元的用量只记一次。实时流只作浏览器预览：

- 删掉补洞（`finalizeBefore`），连同只为它存在的步号代码（`nextFoldStep`、`markTaken`、`pairing.step`）和折叠里的 `sealed` 排除逻辑。`completeStreams(turn, kinds)` 现在只结束这次调用那些流的预览，并释放它们的预留步。它也会结束更早世代里仍开着的流：那条流预览过的内容不在它自己的 wire 步里，如果一直开着，结算时会被当成实时文本写进日志。
- 新增 `vacate(turn, step)` 钩子，在每次持久写入前调用。凡是步号小于或等于这次写入步的实时预览，都改到其上方一个新的预留步，并在那里重新发布。这样后一次调用能继续实时流式显示，也不会和前一次调用的步共用同一个步号。
- 不变的部分：wire 从未记下的流（取消或中途截断的轮次）仍在结算时按实时文本写入，未完成的轮次标 `interrupted`；只出现在 ACP 里的孤儿工具仍写成占位步；取消仍走 `session/cancel`。

**Context Lens：一条结构性的批注规则。** `log-lane.ts` 的 `isMirrorAnnotation` 在下列条件全部成立时，把一条 `assistant/message` 当作历史而不是请求：

1. 日志属于外部 agent（`cursor.external`）；
2. 这一行没有用量（`readUsage(data.usage)` 为 undefined）；
3. 这一行没有 `interrupted: true`；
4. 这一行自己的 `stream` 不存在或为空。判断依据是日志里记下的这一行，在任何读取时的 `harness.timing` 补全之前；
5. 消息有内容，且每个内容块都是 `text` 或 `reasoning`。

这条规则对有记录和无记录的日志一样适用，两条折叠路径也都适用：供成员 Context Lens 用的 `foldLogRows`，和供回填用的 `reconstructSession`。判断放在 `buildRequest` 之前，所以批注不占请求编号，不会移动下一次请求的指纹基线，也不会结束或并入正在等待的旧式调用。紧随其后的请求因此与上一次真实请求对比。

## Testing

- `local-agent-kimi` 测试：改前 325 个，改后 327 个。新的行为测试按线上形状构造：调用 C 的思考先于调用 B（只有一个 Edit）折叠而开始流式输出。现在得到 4 步，用量依次为 `[1,2,3,4]`，没有任何内容按实时文本写入，C 的预览已移到 B 那一步之上；这个测试在旧代码上失败。无步号 wire 的测试改为期望 wire 顺序（思考、工具、文本），不再期望补洞带来的「答案在前」。session-mirror 测试固定写入顺序以及 `vacate` 的调用。
- 快照：两份已有的 kimi 快照（结算时的 wire 折叠、取消的 live 轮）没有变化。新增的 live 快照单独一个提交，同样是线上形状：修复前 5 步、27 个事件（A、单独一步的 C 思考、B 的 Edit、缺了思考的 C 的 Bash、答案）；修复后 4 步、24 个事件（A [思考, Read]、B [Edit]、C [思考, Bash]、答案）。
- `context-lens` 测试：改前 335 个，改后 340 个。`mirror-annotation.spec.ts` 用仿照线上那一对构造的合成夹具，覆盖：有记录和无记录的日志、请求编号、下一次请求的对比基线（`added` = 上一次响应、它的工具结果和这条批注）、harness timing 不会把批注变回请求、用量 / 已记下的 stream / `interrupted` 三者任一都会保留为请求、进程内子代理不受影响。
- 成员 `c937f309` 的真实日志（`zstd -dc` 在内存里读）：实时折叠（`foldLogRows`）在旧代码下得到 429 次请求，新代码下 377 次，52 条没有用量的纯思考行消失；不带 timing 的回填两边都是 377。
- 用 Context Lens 预览框架截图（不提交）：修复前有「#2 · 思考」、token「—」，断点显示「之前 229 字与 #3 一致」；修复后 4 次请求，Edit 显示「与上一请求 #1 的前缀一致」。
- `local-agent` 536、`room` 536、`bundle-local-agent` 5 个测试通过；`pnpm check:plugins` 0 条发现。

## Other providers checked

- **Claude**（live 与 exec）：每次镜像的调用都带用量或推导出的 stream；取消留下的半截内容要么标 `interrupted`，要么带 stream。都不符合规则。
- **Codex live**：每次调用一步，带用量；截断的半截内容带 stream 记录。都不符合。
- **dsh / dsh-headless**：原样复制宿主事件，带宿主自己的 stream 和用量；中断的半截内容有标记。都不符合。
- **Codex exec**（调用边界未记录）：它的思考/文本条目步没有用量，也没有 stream。这些是一次调用里的条目，从来不是单独的一次调用。现在实时折叠也把它们读成批注，回填路径原本就是这样读的。local-agent 契约测试现在期望 codex-exec 那一轮是一次请求（带用量的那一步，标为整轮总量），而不是三行。
- **Kimi** 已完成的轮次里，结算时按实时文本写入、又没有用量的最终消息（wire 一直没刷出来）会被读成批注。这种情况很少，内容仍作为历史显示。

## Alternatives considered

**保留补洞，但把封存的流写进下一次调用的步。** kimi 的 wire 不会把一次调用拆成两步，每次折叠都按写入顺序取步号之后，补洞已经没有事可做。修补它只会为 wire 已经记下的内容多留一个写入方。

**按时间判断的 Context Lens 规则（与下一步同一时刻）。** 不采用，这是靠巧合归属。结构特征（没有用量、没有已记下的 stream、只有文本/思考）才是任何 provider 都不会为真实调用写出的形状。

**在 harness timing 补全之后再判断 stream（旧规则）。** 补全按内容匹配历史流。在拆步的情况下，匹配到的正是下一次调用的流，荒谬的耗时和基线就是这样产生的。

## Consequences

新的 kimi live 轮次每次模型调用一步，成员会话与 Context Lens 的请求数一致；一次调用的思考跟它自己的工具调用待在同一步。旧的成员日志不用改写也能正确读出。遗留的代价：旧日志里的批注排在它被拆出来的那一步之前，Context Lens 把它标成上一次请求的响应；已完成轮次里按实时文本写入且没有用量的最终消息会被读成历史。
