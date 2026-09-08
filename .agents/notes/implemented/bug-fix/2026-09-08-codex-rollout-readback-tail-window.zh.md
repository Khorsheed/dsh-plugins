# Agent Note: codex rollout 回读——尾部窗口，以及并发下的 cwd

Status: implemented

[English](2026-09-08-codex-rollout-readback-tail-window.md) | 中文

## Problem

一次评测跑里，codex 委派轮的 `model.observed` 全是 null，而 `delegations.jsonl`
与 rollout 文件里明明白白写着模型；几分钟前的一次 smoke 委派却顺利读回了
`gpt-5.6-sol`。那次跑有两个 codex 进程同时在飞（`--concurrency 2`），工作目录
各不相同，所以最初的假设是：rollout 定位（threadId + 时间窗）在并发下选错了
文件，或者一个都没选中。

拿那次跑的真实作用域家目录重放定位，结果是另一回事。`codexRolloutTurnModel`
只扫文件末尾 64 KB，可 `turn_context`——唯一写着模型的那一行——是 codex 在
**回合开始时**写的。一轮之后再产生超过 64 KB 的事件，就会把自己的
`turn_context` 挤出尾部窗口：

| rollout | 大小 | `turn_context` 偏移 | 尾部扫描 |
|---|---|---|---|
| smoke 轮 | 38 KB | 33 KB | 整个文件都在窗口内——读到 |
| `f2` 格第一轮 | settle 时 131 KB | 33 KB | 窗口 `[66 KB, 131 KB]`——错过 |
| `f3` 格第一轮 | settle 时 100 KB | 35.4 KB | 窗口 `[34.9 KB, 100 KB]`——读到，只差 546 字节 |

所以根因不是并发，是**单轮长度**。smoke 轮整个文件就在尾部窗口里，评测格的
不在；`f3` 能读到，纯粹是因为它第一轮正好在窗口边界前 546 字节结束。同样形状
的两次跑，一次报模型一次报 null，代码里没有任何东西解释这个差别。

并发仍然是个真问题，只是第二个问题：流里没有 threadId 时（kill 在
`thread.started` 之前截断了流），定位会回落到「窗口里最新的那个文件」，而并发
的格会把好几轮的文件塞进同一个窗口。这时回落读到的是邻居那一轮的模型——不是
缺位，而是错值，评测会把它当作 declared ≠ observed 的错配，把一次本来没问题的
跑判死。

另外，本轮的 `usage` 进了 `delegations.jsonl`，却从来没到过调用方。
`LocalAgentRegistry.trackRun` 在 `run.result` settle 的那一刻就丢掉了这一轮的
`onProgress` 路由，而所有 exec 驱动的 provider 都是在那之后才算出 settle 观测
的（CLI 的流要等进程被回收才算完整）。`settled` 载荷只到了 cordis 事件，别处
一个都没到。

## Decision

**一次回读、一个定位、三件事实。** `codexRolloutUsage` 与
`codexRolloutTurnModel` 合并为 `codexRolloutRoundFacts`：定位本轮 rollout 一次，
返回 `{ usage, model, cliVersion }`。取不到的字段就缺位，绝不猜测。

**rollout 里哪个字段对哪件事是权威**：

| 事实 | 权威字段 | 为什么 |
|---|---|---|
| 线程身份 | `session_meta.payload.id`（旧 build 是 `session_id`） | resume 命令续的就是它 |
| 本轮目录 | `session_meta.payload.cwd` | codex 自己记下的运行目录 |
| 模型 | `turn_context.payload.model`，取本轮时间窗内最后一条 | exec `--json` 线上根本不带模型（codex 0.144.0） |
| codex build | `session_meta.payload.cli_version` | 服务本轮的那个进程自己写的 |
| token 花费 | 最后一条 `token_count` 的 `info.last_token_usage` | 非正常结束的轮次没有 `turn.completed` |

**扫描先读尾部，再读有界的整文件。** `token_count` 在尾部，所以尾部仍是第一次
读；只要它没凑齐两件事实，就补一次从 0 开始的有界整文件读。尾部有的答案优先
（它们才是文件里最后的），整文件读只补空缺。

**定位把本轮 `cwd` 算进去。** `CodexRolloutLocator` 新增 `cwd`，时间窗回落只在
头部记录了该目录的文件里挑（用 `resolve` 比较，尾斜杠等写法差异不影响）。窗口
里有候选但没有一个对得上本轮目录时，结果是**什么都不报**——报邻居那一轮比报
缺位更糟，因为评测会在 declared ≠ observed 上 fail loud，把一次本来正确的工作
判死。唯一的例外是窗口里只有一个候选：没有别的轮次可混淆，这时的不一致是路径
写法差异（比如软链的临时根目录），就用这个候选。

**门面把 settle 后的进度路由多留一会儿。** `RUN_PROGRESS_SETTLE_GRACE_MS`
（60 秒）：result settle 时被跟踪项照样交出取消手柄与心跳，但本次调用的
`onProgress` 转到一条驻留路由上，收到第一条 `settled` 上报或超时（以先到者为准）
即关闭。同一子会话的 resume 轮开始时会先丢掉上一轮遗留的驻留路由。

## Testing

`packages/local-agent-codex/tests/records.spec.ts` 覆盖了远在尾部窗口之外的
`turn_context`、时间窗对 resume 线程里更早回合的过滤，以及三个并发场景：cwd
把同窗的两个文件区分开、cwd 一个都对不上时什么都不报、窗口里只有一个候选时
即使 cwd 不一致也照样作答。`codex-cli-provider.spec.ts` 把其中两个场景放到
provider 上跑——一轮很长的委派，以及一轮流在 `thread.started` 之前就被截断、
而窗口里还躺着一个**更新**的邻居文件。`delegation-facade.spec.ts` 覆盖
`run.result` 已 resolve 之后才到达的 settle 上报。

## Alternatives considered

**把 `TAIL_BYTES` 调大。** 任何常量都是在赌单轮长度；触发这次问题的跑有 500 KB
的 rollout，下一次可以更大。整文件读本来就有 `FULL_BYTES` 兜底，而且只在便宜的
尾部扫描没凑齐时才发生。

**改成从头部读 `turn_context`。** 那会修好模型、弄坏用量——用量确实在文件末尾。
先读尾部、不够再放宽，常见情形仍然只有一次有界读。

**cwd 对不上时回落到窗口里最新的文件。** 这正是原来的行为，也正是会把邻居那一轮
的模型算到本轮头上的那条路。缺位是可恢复的（评测记 null），错值不是——它会把这
次跑判成错配。

**让本轮的 result 等 settle 观测。** 那样每个调用方都能在 `run.result` 之前拿到
观测，但 abort 路径**按契约**是在取消那一刻就 settle 的，进程还没被回收——被取消
的轮次将根本无法上报，而已完成的轮次则会拉长「晚到的取消赢下 settle 竞争」的窗口。
事后驻留路由不花什么代价，也不改任何 settle 语义。

**改评测那边来修 `usage` 的 null。** 评测是在 await 完记录回读之后才读它捕获的
`settled` 的，所以它本来就看得到晚到的上报；而且真正坏掉的是门面契约本身——
「本次调用的 `onProgress` 收到的载荷与 cordis 事件一致」。改消费方等于把同一个洞
留给其他所有调用方。

## Consequences

并发的 codex 委派各读各的那一轮：那次失败的跑里两个 rollout 文件现在都能解析成
`gpt-5.6-sol` 加 `cliVersion` `0.144.0`，连把 threadId 抽掉也一样。窗口有歧义
且目录一个都对不上的轮次，现在报缺位而不是报邻居的值——更诚实，也多了一条拿到
null 的路径。定位仍然每次 settle 走一遍整个 `sessions/` 树（成本不变）；新增的
整文件读只在尾部扫描没凑齐时发生，且受 `FULL_BYTES` 约束。

驻留的进度路由每个已 settle 的轮次最多留一个回调、最多一分钟。投递、超时、同一
子会话的 resume、插件 dispose，四条路都会丢掉它。

关联：[模型回读与 cwd 覆盖](../feature/2026-09-06-local-agent-observed-model-cwd.md)、
[CLI 版本与凭证档位](../feature/2026-09-08-cli-version-and-credential-state.md)。
