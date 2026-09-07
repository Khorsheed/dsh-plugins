# Agent Note: mission — 模型工具按挂载时的组注册

Status: implemented

[English](2026-09-07-mission-tool-groups.md) | 中文

## Problem

一个 profile 挂 mission 可能出于两种完全不同的理由。日常那种，模型**就是**干活的人：它建 mission、沿声明边推进、提交产出、带原因重试。另一种，推动 run 的是别人——服务面的调用方、CLI 里的脚本、tab 前的人——模型在场只为读队列并汇报。在后一种挂载上，写工具不只是用不到，而是一个洞：拿着 `mission_transition` 的模型能挪动驱动方以为自己独占的 mission；`mission_attest` 更直接，它登记的正是 `attested` 转移 guard 要检查的那把钥匙，于是模型能自己满足一个本意就是要求模型之外确认的 guard。

preset 堵不上这个洞。preset 只能在 profile 已注册的工具里挑，挑不掉任何一个。注册了就够得着，所以这个决定只能下在注册发生的地方——插件里，挂载时。

## Decision

插件配置新增 `tools`，三档，默认 `all`：

| `tools` | 注册的工具 |
|---|---|
| `all`（默认） | 全部 12 个——与本配置项加入前完全一致 |
| `read` | `mission_run_list`、`mission_run_status`、`mission_list`、`mission_get` |
| `none` | 无 |

`registerMissionTools(ctx, service, tier)` 把档位作为第三参数（默认 `'all'`），`none` 直接返回，其余情况下每个定义都经同一个本地 `register` 辅助函数，由导出的 `MISSION_READ_TOOLS` 名单裁决。工具本身没动：定义、origin 标签、`tools/pre-execute` 审批管线、`tool:<sessionId>` 归属，凡是注册了的都照旧。

`mission_is_releasable` 只读，但不进 `read`。它回答的是「本 mission 持有的资源可否销毁」——属于持有资源的那一侧，而 `read` 挂载按定义不是那一侧。`read` 组恰好是队列投影加单个 mission 的详情。

系统提示词段 `tool:mission` 跟着档位走，不描述不存在的工具。`all` 原文照旧，逐字不变。`read` 换成自己的文案，只点这四个工具，并说明 mission 由拥有 run 的一方排队与推进，所以模型汇报队列、请求变更，而不是自己动手。`none` 干脆不注册这一段：没有工具，工具带里的段落无话可说。

被裁的只有模型工具面。服务面（`ctx.mission`）、`/mission` slash、`dsh-mission` CLI、Remote 支撑的会话 tab 在三档下挂载方式完全相同；`inject` 三档都是 `['commands', 'tools', 'systemPrompt']`——`none` 挂载照样组装系统提示词、照样有工具注册表，只是往里放零个。

## Alternatives considered

**让 profile 的 preset 去掉写工具。** 否决，因为它根本做不到：preset 只在已注册工具里挑，减不掉任何一个，无论 preset 怎么写，写工具都够得着。这正是开关必须落在插件里的全部理由。

**逐工具布尔（`tools: { transition: false, … }`）。** 否决：这种配置面会随每加一个工具而变长，还允许挂载方描述出没人推敲过的组合——比如给 `submit` 不给 `transition`。三个有名字的档位逼挂载方说清自己的角色：模型干活、只读、还是根本看不见。

**因为 `mission_is_releasable` 不写就把它放进 `read`。** 否决：分组按角色，不按「有没有写」。可释放性是资源持有方的问题；让一个什么都不持有的挂载去回答它，等于引诱模型去推理销毁不属于自己的资源。

**三档共用一段提示词。** 否决，两个方向都不成立：`read` 下描述 12 个工具会引来调不通的调用；把段落削成一串工具名又丢掉 `all` 挂载依赖的用法指引。两份文案按档位选，每个挂载的提示词都与它真正注册的东西相符。

**`none` 下不注册工具但保留这一段。** 否决：`tool:mission` 位于工具带，存在的目的是向模型交代可调用的工具。描述一个够不着的面，是没有动作兜底的提示词重量。

## Consequences

- 默认挂载没有任何变化：`all` 注册同样的 12 个工具与逐字节相同的提示词，现有 profile 升级后行为不移位。
- `read` 或 `none` 挂载切断模型对 mission 的写路径，同时不碰另外三个面——这正是这次裁剪安全的原因：run 照样在动，只是不从模型这一侧动。
- 档位在挂载时选定，不是按会话的：同一个实例无法给一个会话写工具、给另一个不给。既要又要的 profile 挂两个实例，或把工作拆到两个 profile。
- `MISSION_READ_TOOLS` 已导出，挂载方可以直接断言 `read` 的含义，而不必重抄四个名字然后各自漂移。
- 新加的工具默认只进 `all`。要进 `read` 必须显式改名单——这个方向失败时是安全的。

## Testing

`packages/mission/tests/tools-config.spec.ts` 用一个记录型 ctx 在临时数据根上挂载插件，逐档覆盖：默认与显式 `all` 注册全部 12 个名字；`read` 恰好注册 `MISSION_READ_TOOLS` 四个，且不含 `mission_is_releasable`；`none` 既无工具也无提示词段。`read` 一例还断言该段文案包含四个读工具名、且不含八个写工具名中的任何一个，提示词因此无法悄悄漂回去描述本档未注册的工具。第四例把三档各挂一遍，检查 slash 面每档都照常注册，把「只裁工具面」这条边界钉住。mission build 与全部 128 个测试通过。

## Cross-references

- [mission attempt 审计与 guard 缺口](../bug-fix/2026-09-04-mission-attempt-audit-and-guard-gaps.zh.md)——retry、submit 意向边、`writtenBy` 都落在同一个工具面上；本篇补的是这个面到底存不存在。
- [Mission M1](2026-08-19-mission-m1.zh.md)——12 个工具的面与「export 不做成工具」这条边界的归属者，本次分组决定是它的延伸。
