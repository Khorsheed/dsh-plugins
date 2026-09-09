# Agent Note: tool calls in the settled observation, and a per-round spend ledger

Status: implemented

[English](2026-09-09-tool-calls-and-usage-ledger.md) | 中文

## Problem

效率表有六列——活跃时长、委派轮次、输出 token、输入 token、cacheRead、标价成本
——独独没有读者最常问的那一列：这个 harness **干了多少活**。token 说的是有多少
文本流过，说不出这一轮是跑了一条 shell 命令还是四十条。

而这份信息四家 provider 早就都有。为了把转录镜像进子会话，四家都在解析工具事件
——codex 的 `command_execution` / `web_search_call` item、claude 的 `tool_use` 块、
kimi 的 `tool.call` wire 行、子 dsh 的 `tool/call` 事件——并把它们折成子会话里的
工具卡片。只是从没有人去数，于是下游也就无从读起。

token 那几列还有第二个、更安静的缺口。它们是按轮算出、按条件合并的，而**唯一**留
下逐轮数字的地方是 bundle 里的一条 mission 注解。报告之外的任何一环——套单价表的
计价、想知道哪一轮贵的复核——都得自己再走一遍注解树，并把报告的「只算已完成格」
规则重新实现一遍才能得到同一个答案。报告把这份算术留在了自己肚子里。

（计价本身不在本次改动内：`标价成本` 列仍读 `run.meta.pricing`，今天没人写它，所以
照旧留空。单价表由 bundle 之外的非模型环节套用；本次只保证它需要的逐轮事实确实落在
盘上、读得到。）

## Decision

### settle 观测加 `toolCalls`

`LocalAgentRunProgress` 的 `settled` 分支加一个可选的
`toolCalls: { count, byName? }`，每轮一份，与 `observedModel`、`cliVersion`、
`usage` 并列上报。

**只从 provider 已经解析的事件里数。**不新增解析路径、不再走一遍流、不新开回读
通道。具体是：

| harness | 在哪儿数 | `byName` 的键 |
|---|---|---|
| codex | 流折叠**已经走过**的那几个 `item.completed` 分支 | `command_execution`、`web_search_call`——codex **自己的** item 类型，不是镜像卡片上的 `Bash` / `WebSearch` 显示名 |
| claude-code | 同一折叠的 `tool_use` 分支 | 块自己的 `name`：`Bash`、`Read`、`TodoWrite`，MCP 工具则是 `mcp__server__tool` 全名 |
| kimi | transcript 里带**本轮 turn** 的 `tool.call` 行 | wire 给这个工具的名字 |
| dsh | `roundObservation` 已经在走的那段本轮窗口里的 `tool/call` 事件 | 事件自带的名字 |

有三处细节各自挣到了自己的位置：

- **codex 的 `function_call_output` 绝不计数。**它是结果，会并进前面那次调用；
  计它等于把每条命令数成两次。
- **claude 的 `TodoWrite` 要计**，尽管折叠逻辑把它挪去了 todo 快照、不进 transcript。
  CLI 确实调了这个工具；跟着 transcript 走的计数会少报这一轮。
- **kimi 与 dsh 按「本轮」数，不按镜像窗口数。**两家都是增量镜像：settle 那一遍的
  delta 可能已被 live 轮询清空，那样就会报成 0；而 kimi 的 resume 轮则会把前几轮的
  调用一并算进来。两家改为读本轮自己的那一段。

**`byName` 绝不跨家归一。**键就是各家 CLI 自己的词汇，原样保留。因此横比只比
`count`，README 也这么写：一套共享分类法是四个 CLI 从未约定过的等价关系，由我们凭空
造出来，再拿去当测量结果比较。

**缺席不是 0。**没报过计数的轮次整个字段缺位——「harness 没数过」和「这一轮没用工具」
是两件事，只有缺席能诚实地说出第一件。这条规则贯穿整条路径：settled 事件、注解、
表格单元、台账行。

**`toolCalls` 只走事件，绝不进委派记录。**记录讲的是一次委派的最新状态（模型、build）；
把逐轮计数并进去，等于用最新一轮悄悄盖掉上一轮的数字。

只有 exec 路径会报它，因为今天**只有** exec 路径会报任何 settle 观测——长驻驱动发的是
`delta` 与 `mirror` 进度，根本没有 `settled`。于是 `toolCalls` 落在了 `usage` 与
`observedModel` 本来就在的地方，而评测钉的驱动正是 exec。

### 评测这边：一列，加一份台账

`DelegationProgress` 加上 `toolCalls` 与 `cliVersion`；run 循环把两者按 `usage` 同样的
方式并进委派注解，本轮没报就不写。效率表加一列 `工具调用`，按已完成格汇总（T23 规则），
没有任何一轮报过计数时打「—」，并在表下用一行说明为什么。

`report/usage.jsonl` 是新的：**一轮委派一行**，带
`{run, cell, attempt, condition, task, stage, round, counted, observedModel?,
cliVersion?, durationMs?, usage?, toolCalls?}`。它不聚合、不计价。效率表就是它
`counted: true` 那些行的和，外部计价读这个文件，而不是再去走一遍 bundle。

`counted` 标的是这一行在不在效率表的口径里（当前 attempt 且已完成）。口径外的行是
**留着**而不是丢掉：那是真实花销，表是有意排除它，而外部读者可能要的口径与比较不同。
`attempt` 出于同样理由带上——重试的格子沿用同一个 mission id，只有 `cell` 分不开两次
attempt 的轮次。

`results.jsonl` 加一个可选的、按**格**汇总的 `toolCalls`（该格各轮之和，重复在该格每
一条判定行上），此外不变：本格没有任何一轮报过计数就整个键缺位——这正是在旧 bundle 上
复算出的报告逐字节不变的原因。

## Real-machine verification

两家各跑一轮真机：直接驱动已交付的 provider 入口、对真实 CLI，回读 settle 的
`toolCalls`，再与同一轮镜像进子会话的工具卡片对照：

| harness | 任务 | `toolCalls` | 镜像出的工具卡片 |
|---|---|---|---|
| codex | 列目录并统计文件数 | `{count: 1, byName: {command_execution: 1}}` | `[Bash]` |
| codex | 两条 shell 命令后作答 | `{count: 2, byName: {command_execution: 2}}` | `[Bash, Bash]` |
| claude-code | 列目录并统计文件数 | `{count: 1, byName: {Bash: 1}}` | `[Bash]` |
| claude-code | 用 Read 读两个文件再跑 ls | `{count: 3, byName: {Read: 2, Bash: 1}}` | `[Read, Read, Bash]` |

codex 那两行正是命名决定的可见处：同一次调用，计数写的是 `command_execution`
（codex 的 item 类型），镜像卡片写的是 `Bash`（显示名）。

用本分支复算 pilot-a-round1 bundle，并与同一 bundle 在 `main` 上的复算对照：

- `results.jsonl`——**逐字节相同**。那个 bundle 没有任何一轮记过计数，因此没有一行
  长出新键。
- `summary.md`——多一列，全是「—」，外加一行点名哪些条件没报过计数。
- `report/usage.jsonl`——新增，7 轮委派 7 行。它 `counted: true` 的行复现了表格：
  codex 4 轮 / 21.0 min，dsh 2 轮 / 11.9 min；唯一一行 `counted: false` 是只跑完阶段
  一就停住的那个 dsh 格子，T23 把它排除在表外，而这个文件把它留下。

## Alternatives considered

**把工具名归一成一套共享分类（`shell`、`read`、`search`）。**否决。那套映射是我们的、
不是 CLI 的，读者从此要透过一张没人验证过的对照表去比四家——比「比计数、读原名」更糟。
`count` 才是诚实的可比量；`byName` 是给想知道到底跑了什么的人看的。

**新开一遍流解析来数，或者从子会话镜像出的工具卡片上数。**否决。多一次解析就是多一处
要跟着 CLI 变的地方；而镜像卡片是展示面：codex 在那里把 `command_execution` 改名成
`Bash`，claude 的 TodoWrite 压根不成卡片，长驻镜像过的一轮的卡片还可能在 settle 之前
就已经在会话里了。在已经读这些事件的折叠里数，只有一份真相。

**没调用工具的轮次报 `count: 0`。**否决。只有报了计数的 harness 才分得清 0 与未知，而
表里的 0 会被读成对一个什么都没测的旧 bundle 的测量结果。改为让缺席一路传下去，表里打
「—」并附一行解释。

**像 `observedModel` 一样把 `toolCalls` 并进委派记录。**否决：记录是按委派的，计数是按
轮的，合并只会留下最后一轮的数字，却长得像个总数。

**把逐轮台账塞进 `results.jsonl`。**否决：那个文件是一行一个**判定**，而判定没有自己的
轮次——轮次要么在每条判定行上重复，要么被压成一个总数。单独一个文件让「轮」保持为行的
单位，也让旧 bundle 的 `results.jsonl` 保持逐字节不变。

**`usage.jsonl` 只写已计入的轮次，就不需要 `counted` 字段了。**否决：那会悄悄丢掉外部
计价可能要的真实花销，而且从文件里再也找不回来。一个布尔值就能把两种口径都留下。

**顺手把计价那列也写了。**按决定属于范围之外：单价由 bundle 之外的非模型环节套用，
`run.meta.pricing` 仍是它本来的读法。本次只保证那一环有一份逐轮的文件可读。

## Consequences

委派注解多了两个可选字段。旧 bundle 照常加载（两者都按可选读，缺席仍是缺席），在旧
bundle 上复算出的 `results.jsonl` 与从前相同。

`usage.jsonl` 每次导出都写，空文件也写——空文件说的是「没有记到任何一轮委派」，而文件
不存在则与「这次导出早于台账」分不开。

四家的计数只在总数上可比。其中两家（kimi、dsh）按自己事件的词汇给工具命名，因此跨家比
`byName` 等于在比四本字典；README 与字段的文档注释都写明了这一点，但没有任何机制去强制
它。

长驻驱动的轮次不报 `toolCalls`，因为它根本不报任何 settle 观测——`usage` 与
`observedModel` 在那里本来就有同一个缺口。补上它意味着给长驻驱动一条 settled 通道，那是
另一件事，本次没有开工。
