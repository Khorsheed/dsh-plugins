# Agent Note: the sub-dsh session log is addressed by generation, not by name

Status: implemented

[English](2026-09-11-dsh-session-log-generation.md) | 中文

## Problem

`dsh` harness 的每一项回读都出自同一个文件：作用域目录里子 dsh 自己的会话日志。有两个读者会打开它——会话镜像（从中导出本轮的实测模型、token 用量、工具调用计数）和 `/dsh sessions` 记录适配器（读每个会话的头行）。两者都把基名写死成了 `session.jsonl.zstd`。

而宿主是按**会话格式代次**来寻址这个日志的：第零代保留最初的 `session.jsonl`，此后每一代带一个小写的 `vN`。宿主 0.1.5 写的是 `session.v3.jsonl.zstd`——去找 `session.jsonl.zstd` 的读者，什么都找不到。

一次性 HOME、每条 toolchain 各跑一轮真实委派，实测：

| toolchain | store 实际写的文件 | 修复前的 `settled` 观测 |
|---|---|---|
| `rc-0.1.2-rc.1` | `session.jsonl.zstd` | 模型、用量、toolCalls、cliVersion |
| `rc-0.1.5-rc.1` | `session.v3.jsonl.zstd` | **只有** `cliVersion` |

那一轮照样 settle 成 `completed`。失败是安静而彻底的：三项观测一起消失，`/dsh sessions` 一条都列不出。到了下游，「日志读不到」与「这一轮什么都没产生」长得一模一样——报告的第三条不变量对每个 dsh 格只剩声明侧，效率表的 dsh token 列全空，pilot B（dsh × 两模型）两格根本配不出对子。

## Decision

### 一个解析函数，用宿主自己的规则

`src/session-log.ts` 用宿主的正则逐个解析会话目录里的条目，规则逐字抄自 `@deepseek-ai/dsh-session-format`：

```
/^session(?:\.v([1-9][0-9]*))?\.jsonl$/u      # 去掉 .zstd 之后再匹配
```

于是 `.v0`、前导零（`v01`）、大写（`V3`）、`session.lock` 与临时文件都不是代次——宿主不发布它们，接受它们的读者会去读一个写入方从未提交过的文件。第零代就是那个没有版本号的原始名字。

`resolveDshSessionLog(dir)` 返回目录里**版本号最高**的那个规范代次，这正是后端自己的选择规则；同一代次里压缩件胜出（压缩是后端缺省，两份并存只会出现在改过设置的 store 里）。缺位就是缺位：没有规范日志的目录——比如只剩一个锁文件——返回 undefined，而不是一段空历史。

**是「最高」，不是「mtime 最新」，也不是字典序。**就地迁移过的 store 会把旧代次留在新代次旁边，所以「磁盘上最新的文件」不是规则；而 `v10` 必须压过 `v2`，字符串排序恰好反了。

### 两个读者走同一条路

会话镜像与记录适配器经同一个函数解析，于是两者不可能对「历史在哪个文件里」产生分歧——而分歧正是下一次宿主推进代次时，第二个写死常量必然会制造的东西。

`readSubDshEvents` 现在返回 `{events, log}`，`DshMirrorDelta` 带上 `sessionLogFile`。回读会说出自己读的是**哪一代**，于是下一次文件名变化表现为一个字段变了，而不是一段空会话。`readDshSessionHeaderLine` 把编码收作参数——原始（`compression: 'none'`）日志是真实存在的，而它此前同样读不了。

## Verification

修复之后，每条 toolchain 各跑一轮真实委派，写进一次性 `DSH_HOME`：

| toolchain | 解析到的文件 | observedModel | usage | toolCalls | `/dsh sessions` |
|---|---|---|---|---|---|
| `rc-0.1.5-rc.1` | `session.v3.jsonl.zstd` | `deepseek-official/deepseek-flash` | 479 in / 133 out / 13952 cacheRead | `{count: 1, byName: {bash: 1}}` | 1 条 |
| `rc-0.1.2-rc.1` | `session.jsonl.zstd` | `deepseek-official/deepseek-v4-flash` | 8387 in / 224 out / 16000 cacheRead | `{count: 2, byName: {bash: 2}}` | 1 条 |

两条路径都用新旧两线的夹具钉住：v3 夹具带上真实 0.1.5 目录里那个与日志并排的 `session.lock`，另有一个多代次夹具证明 `v10` 压过 `v2`。复算 pilot-a-round1 的 bundle，`results.jsonl` 逐字节相同——本包不碰报告。

## Alternatives considered

**把常量改成 `session.v3.jsonl.zstd`。**否决：那只修好一个宿主版本，并为 v4 重新上膛同一次安静的失败。这个 bug 的代价从来不是名字错了，而是名字可以过期而没有任何东西说一声。

**按已知名字依次试（先 `v3`、再 `v2`、再无版本）。**同一个理由高一层地否决——那份清单仍然要随宿主发布逐条编辑——而且它在迁移过的 store 上是错的：那里多代次并存，只有最高的那个是历史。

**取修改时间最新的文件。**否决：迁移会改写旧代次旁边的文件，锁文件更是一直被碰，mtime 回答的是另一个问题，不是「哪一代是当前的」。

**直接 import 宿主的 `parseSessionFormatLogFilename`，而不是把规则重述一遍。**很有吸引力，但按本包的兼容性标准否决：那个符号住在 `@deepseek-ai/dsh-session-format` 里，本插件并不依赖它，为了读一个文件名而新增一个宿主依赖，会让本包在早于该模块的宿主上直接拒绝加载。正则只有四行，出处就写在它正上方。

**让镜像保留自己的一份解析。**否决：两份拷贝正是两个读者当初分道扬镳的原因——`/dsh sessions` 在 0.1.5 上坏掉的理由与镜像一模一样，只是坏在一个上次改镜像时谁也没想起来去看的文件里。

## Consequences

`readSubDshEvents` 换了形状（`SessionEvent[]` → `{events, log}`）。它是导出的，树外调用方需要跟着改；树内只有一个调用点和一处测试。

`DshMirrorDelta` 多了 `sessionLogFile`。它是可选的、找不到日志时缺位，因此按相等比较 delta 的读者会在成功路径上多出一个字段——本包自己的测试是仅有的这类读者。

宿主推进到本包从未见过的代次仍然能用：规则是宿主的，不是一份清单，所以 `session.v4.jsonl.zstd` 出现那天就能解析。真正会打破它的是宿主换掉命名**方案**而不是数字——那时解析器报缺位，那是诚实的答案，而 `sessionLogFile` 现在让它可诊断。
