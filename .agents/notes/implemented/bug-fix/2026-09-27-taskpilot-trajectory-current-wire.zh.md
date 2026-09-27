# Agent Note: The job detail tab's trail fold reads the current session-log wire

Status: implemented

## Problem

详情页的执行轨迹由 `packages/taskpilot/src/client/job-trajectory.ts` 从会话日志折叠而来：它挑出一个后台 job 留下的行，并把每个 `tool/call` 与它的 `tool/result` 配对。它读应答调用 id 的位置是 `message.content[0].toolCallId`，读文本的位置是同一个块里嵌套的 `content[].text`——那是 0.1.5 之前宿主的形状。当前宿主把 id 写在 message 上（`message.toolCallId`，并在 `message.source.callId` 镜像一份），文本是扁平的 `message.content[]` 块，而完成通知的生产者写在 `source.kind`，不再是 `source.plugin`。

这个错配是静默失败的，而且失败的方向恰好看起来像「日志里什么都没有」：没有任何 result 能配对成功，于是后台 `bash` 调用永远铸不出起始行，`job_output` 的结果也永远无法升级该行的 detail。剩下的只有折叠从调用自身参数里铸出的行——即在参数里点出 job id 的 `job_output`/`job_kill` 行——所以打开一个被 kill 过的 job，轨迹里就只有那条 kill。

折叠会话 `session-70b25dac` 的真实工具行可以精确复现：`buildJobTrajectory(rows, 'bash-31')` 只返回一条 `kill`，而 `bash-9`、`bash-12`、`bash-65` 返回空——尽管在**同一页**里它们各自都有后台启动，多数还有 `job_output` 读取。通知分支同样因为同一原因而死：真实行带的是 `source: { kind: 'tool-jobs', form: 'notice' }`。

## Decision

会话日志的读取器归 `packages/taskpilot/src/client/session-wire.ts` 所有：`SessionLogRow`、`asRecord`/`asArray`/`parseArgs`、`resultCallId`（先 message 字段，再镜像的 `source.callId`，最后嵌套的 content 块）、`rowText`（同时读扁平与嵌套文本，来源是 `message.content` 和顶层 `content`）、`isJobsNotice`（`tool-jobs` 生产者的 `form: 'notice'`，当前线缆写在 `kind`、旧线缆写在 `plugin`），以及两个 ack 匹配器 `BACKGROUND_JOB_ACK` 与 `PROMOTED_JOB_ACK`。折叠与宣告过滤器都读它们；`announced-jobs.ts` 修胶囊时曾自己长出一份副本，那份副本原样搬到了这里，所以过滤器的既有行为不变。

折叠的 `bash` 分支不再要求 `run_in_background: true` 才进入 pending 表，因为配对到的那条 result 才说明它属于哪一类：后台调用认领任何点出自己 id 的 ack（ack 不可读时依旧铸行——调用本身就是这个 job 存在的证据），而前台调用只认 `moved to background job <id>`，也就是它超时换来的提升。因此纯前台调用依然什么都不铸，而被超时提升的前台调用现在能铸出以前铸不出的起始行。

折叠还接受一个可选的注册时间。job id 只在单个宿主进程内唯一：重启会让 `<kind>-N` 的序号重新开始，所以一个长会话的日志会在同一个 id 下装着好几个不同的 job——在同一个会话里就能看到，`bash-4` 与 `bash-19` 各自对应两条不同的命令，分别落在一次宿主重启的两侧。详情页把花名册行的 `startedAt` 传进来，折叠只保留不早于它减去 `REGISTRATION_SLACK_MS`（2 秒，为调用行写在 job 注册前一次解析的量级）的行。花名册行已经消失的 job——早于上次重启的那些——照旧折叠整页。

每一处 id 提及都按整词匹配（`./src/client/session-wire.ts` 的 `mentionsJobId`），因为 kind 之间互为前缀：`bash-1` 是 `bash-12` 与 `bash-19` 的前缀，`text.includes(jobId)` 于是让短 id 认领了长 id 的 ack 与完成通知。这在实时会话日志上被看到：`bash-1` 的轨迹开头是 `bash-19` 的通知，以及一条 ack 写着 `started background job bash-12` 的起始行。宣告过滤器从来没有这个缺陷：它把捕获到的 id 用 `===` 比较。

## Alternatives considered

**改用 job controller 的 `job.follow` 流（`ctx.jobs.observe`）折叠轨迹。** 既然详情页的 job 元数据已经来自那条通道，这是看起来最自然的动作，而且它自带日志折叠需要重建的保留输出。被否决是因为它回答的是另一个问题：这条流给的是一个 job 的输出与终态，而不是轨迹——发出的命令、每次读取、每次 kill、完成通知——而且 registry 对已 settle 的前台调用根本没有记录，而那恰恰是人们打开这个页时看着的那一行。它仍然是实时输出面板的正确来源。

**把读取器留在 `announced-jobs.ts` 里、由折叠 import。** 不新增模块，且只有一处要改。按方向被否决：读取日志是共享词汇，宣告判定只是它的一个消费者，那样折叠就要依赖宣告过滤器——而那个模块的存在意义正是在宿主给 job 加上 background 标记后退场。

**只修调用 id、不动文本提取。** 半个修法：配对能成，但 `rowText` 仍在读嵌套形状，于是每条 `job_output` 行的 detail 依旧是参数 JSON，运行输出仍为空。

**折叠整页、跳过注册时间下限。** 最简单，而且就是修复前的行为。在真实长会话上看到后果后被否决：重启后复用同一 id 的两个 job 会被并成一条轨迹，读起来就像这个页在展示该 job 从未跑过的命令。

## Consequences

赚到：详情页显示这个 job 真正做了什么——命令、每次读取及其返回的输出、每次 kill 及工具的回执、以及完成通知——并且两种宿主线缆形状都能读。被提升的 job 也有轨迹了。跨重启复用 id 的两个 job 不再被并成一条。

代价：折叠会跳过早于「花名册行注册时间减去 slack 窗口」的行，所以前一个占用该 id 的 job 在这段窗口内写下的条目仍可能露出来；而没有花名册行可用的 job（早于上次重启）仍折叠整页。详情页会在花名册行到达时重新读一次最新页，因为注册时间是折叠的输入，而那行可能在页面打开后一帧才到。

## Testing

`tests/job-trajectory.spec.ts` 新增八个用例：当前线缆形状上，经 `message.toolCallId` 配对并读扁平文本（起始、读取、kill、通知，以及各 result 完成的 detail 升级）、经镜像的 `source.callId` 配对、提升产生的起始行、纯前台与异族生产者的反例、注册时间下限；id 匹配上，长 id 的 ack 与通知反例，以及被接受的边界形式。本包 88 个测试全绿。

随后折叠在真实日志上跑过。在抓下来的 `session-70b25dac` 工具行上，`bash-31`、`bash-4`、`bash-19`、`bash-40` 现在都能给出各自的命令、输出与 kill 行，而修复前它们只给出一条孤立的 kill 或什么都没有。在同一会话的实时日志上（取自已部署构建启动一个后台 job 并用 `job_output` 读它之后），`bash-1` 恰好给出两条：带发出命令的起始行，以及携带 `alpha-line`、`beta-line`、`gamma 42` 与终态行的 `job_output` 行——有注册下限与没有都一样。正是这次实时折叠暴露了子串匹配：没有边界规则时，同一条轨迹开头是 `bash-19` 的通知和一条 ack 写着 `bash-12` 的起始行。

## Related

- [TaskPilot's Background jobs capsule lists only the jobs the tool announced](2026-09-26-taskpilot-announced-background-jobs.md) —— 共用这些读取器的胶囊过滤器，也是把这个缺陷记为「此处故意不修」的那份记录。
- [TaskPilot trajectory rows carry the issued command line](../feature/2026-08-21-taskpilot-trajectory-command-lines.md) —— 本折叠所填充的行词汇。
- [Host 0.1.7-rc.1 adaptation](../architecture/2026-09-24-host-017-rc1-adaptation.md) —— 折叠此前误读其线缆形状的那条宿主线。
