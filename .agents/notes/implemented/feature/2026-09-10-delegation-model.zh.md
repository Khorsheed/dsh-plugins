# Agent Note: the model a delegation asks for

Status: implemented

[English](2026-09-10-delegation-model.md) | 中文

## Problem

条件文档会声明一个模型。可到现在为止，那个声明只被**核对**过——从来没有被**请求**过。委派门面上根本没有模型这一项（`DelegationCallOptions` 只有 label、signal、onProgress、reattach、cwd、exec、scope），所以编排器构造委派选项时不带模型，事后才去比回读。

T30a 从另一侧收窄了这个口子：三家 harness 拿到了 `model` 插件配置键。但插件配置键是**按 provider 全局**的。同一家两条条件跑两个模型，一把键表达不了——而评测的整个形状恰恰是「同一家，只差一项」。

T22 第 5 步就是它的代价。判官条件声明 dsh v4-pro；子 dsh 继承的是宿主实例的默认 v4-flash；就绪探针回读到 v4-flash，看见不符，拒。把判官改声明成 v4-flash，又与 dsh **选手**在 `(harness, model)` 上撞成 JUDGE_IS_PLAYER。两种声明都跑不了，因为两种都请求不出去。I4 的 pilot B/C 那种「同一家两个模型」的条件，同理造不出来。

dsh 还差一截：无头子 dsh 的启动面上没有按次指定模型的位置（只有 `--session-id` / `--resume` / `--serve`），模型来自 `agentDefaultModel.currentSelection()`，宿主实例以下没有任何东西动得了它。

## Decision

### `DelegationCallOptions.model`——按委派，且只在 `start`

门面接受**某一次委派**的模型。它像 `cwd`、`exec`、`scope` 一样搭上暂存的 fresh intent，并由 provider **记进委派记录**。

**`resume` 拒收。**模型属于这次委派，不属于它的某一轮：首轮记下请求了什么，之后每轮照发（首轮没写就一直不写）。往 `resume` 传一个会在暂存任何东西之前抛错。这是整个设计里唯一可以选择「收下但忽略」的地方，而安静是更差的选项：CLI **确实会**照办一次中途换模型，而转录里看不出来。抛错让调用方知道；对话保持一个模型。

**带 model 的轮次是 exec-only**，由 `assertModelExecOnly` 强制——T29 的 `assertScopeExecOnly` 的孪生，理由也一样：常驻 runtime 在**起进程时**绑定模型，然后为这个成员的很多轮服务，按委派给模型要么被忽略、要么会悄悄改掉那个 runtime 上其他轮次跑的模型。插件配置键**不受**此限：它是全家统一的，runtime 绑定它正是实例要的。

### 取值顺序只写一处

`resolveRoundModel(requested, configured)` 住在家族核心里，四家 provider 都把它的结果摊进 run spec，所以顺序只声明一次：

1. 本次委派自己的 `model`（fresh 取 intent，resume 取记录）
2. 该家的 `model` 插件配置键（T30a）
3. 该家的作用域配置文件
4. CLI 自己的默认

四层都没有 = argv 上**一个模型参数都不加**，与这两层出现之前逐字节相同。任一层的空白值都读作没写，所以清空的设置字段不可能产出一个空的旗标值。

`effectiveSettings.model` 有意仍从第 2 层往下答：它说的是「一轮没有自带模型时会跑什么」，那是条件快照要问的 harness 级事实，不是按委派的。

### dsh：headless 的 `--model`，以及 T30a 欠的那把键

`dsh --profile headless-local-agent-dsh --model <provider/model>` 覆盖子实例的默认选择——经 startup provider、patch 的 runner 行，落到 agent loader 的 `applyModelRequest`，它同时喂 `agentOptions` 与 `installModelSelection` 的 ref，让瀑布流与 agent 说的是同一件事。

值按**第一个**斜杠切分，所以模型 id 里再带斜杠也不会被切坏；只写模型名则沿用实例的 provider；开头或结尾的斜杠不算切分点（那会切出一个空的一半，agent 路由不了）。选择的其余部分——尤其是 reasoning effort——原样带过：换模型不是重置配置。

`--serve` 之下它绑定这个常驻进程托管的**每一个**会话。这不是一个要绕开的限制，它就是「按委派给模型必须 exec-only」的同一个事实，只是站在 wire 的另一侧说出来。

有了启动路，dsh 就补上了 T30a 给不了它的 `model` 插件配置键，以及另外三家早就有的设置卡那一行；它的 `effectiveSettings.model` 现在先读键、再读宿主选择。

### eval：声明变成请求

选手轮（`run.ts`）、判官委派（`judge.ts`）、就绪探测（`readiness.ts`）三处都把非 null 的 `model.declared` 作为委派级 `model` 传下去；声明为 null 就照旧什么都不传。resume 轮不传——家族会把记录里的请求重发一遍。

比对本身没动：请求了 X 却回读到 Y，仍然是 `MisattributedRun`。变的是探针现在证明的是**格子将要做的事**，而不是「实例默认恰好是什么」。`run.meta.readiness` 与每条委派注解各多一个 `requestedModel`，与回读并列，读的人分得清「要了 X 拿到 X」和「什么都没要，拿到 X」。

条件契约的**形状**没有改变。`model.declared` 从「只用来核对」变成「先请求，再核对」；协议把这个记成一次描述改动，v1-rev9。

## Real-machine verification

每一轮都用**已交付的** provider 驱动真实 CLI，委派级模型与插件配置模型**故意不同**，然后用同一次委派 resume 一轮、且一个模型都不带：

| harness | 轮次 | 插件配置 `model` | 委派 `model` | argv 上的旗标 | 记录 | 回读 |
|---|---|---|---|---|---|---|
| codex | fresh | `gpt-5.6-terra` | `gpt-5.6-luna` | `-m gpt-5.6-luna` | `gpt-5.6-luna` | `gpt-5.6-luna` |
| codex | resume（不带） | `gpt-5.6-terra` | — | `-m gpt-5.6-luna` | — | `gpt-5.6-luna` |
| claude-code | fresh | `claude-sonnet-5` | `claude-haiku-4-5-20251001` | `--model claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` |
| claude-code | resume（不带） | `claude-sonnet-5` | — | `--model claude-haiku-4-5-20251001` | — | `claude-haiku-4-5-20251001` |

两条 fresh 证明了顺序（委派压过插件键），两条 resume 证明了记录（调用方一个字没提，模型还是那个）。

dsh 对真实子 dsh（实例凭据、0.1.2-rc.1 的 toolchain 入口、一次性作用域目录）：

| 轮次 | 插件配置 `model` | 委派 `model` | argv 上的旗标 | 回读 |
|---|---|---|---|---|
| 基线 | — | — | 无 | `deepseek-official/deepseek-v4-flash`（实例默认） |
| 只有插件键 | `…/deepseek-v4-pro` | — | `--model …/deepseek-v4-pro` | `deepseek-official/deepseek-v4-pro` |
| 委派级 | `…/deepseek-v4-flash` | `…/deepseek-v4-pro` | `--model …/deepseek-v4-pro` | `deepseek-official/deepseek-v4-pro` |

三轮都 settle 成 `completed`，于是第 1、2、4 层在 dsh 上各自都有真机证据。

以及这整件任务存在的理由——**判官 dsh v4-pro、选手 dsh v4-flash** 的那份计划，用真实的 `checkReadiness` 跑真实的子 dsh 委派：

```
readiness p0-dsh-flash: ready (2.2s, model deepseek-official/deepseek-v4-flash)
readiness p0-judge-dsh-pro: ready (2.9s, model deepseek-official/deepseek-v4-pro)
```

```json
{"condition":"p0-dsh-flash","role":"player","ok":true,"declaredModel":"deepseek-official/deepseek-v4-flash","requestedModel":"deepseek-official/deepseek-v4-flash","observedModel":"deepseek-official/deepseek-v4-flash"}
{"condition":"p0-judge-dsh-pro","role":"judge","ok":true,"declaredModel":"deepseek-official/deepseek-v4-pro","requestedModel":"deepseek-official/deepseek-v4-pro","observedModel":"deepseek-official/deepseek-v4-pro"}
```

两条都 READY，各自回读到自己声明的那个模型——T22 第 5 步的那个形状，现在过了。两条条件在 `(harness, model)` 上不同，因此 JUDGE_IS_PLAYER 不触发；那条规则要不要再放宽是 T31 的事。

## Alternatives considered

**让 `resume` 收下模型并生效。**否决：CLI 会照办一次中途换模型，而转录不记录，于是一次 run 可以中途换了题却看起来仍然自洽。把首轮的请求记下来、之后照发，让「一次委派一个模型」成为一条性质，而不是一个约定。

**让 `resume` 收下模型但忽略它。**以更安静的形式犯同一个错，否决：传了它的调用方相信了一件系统并不做的事。抛错本身是信息。

**把带模型的轮次从 live 悄悄降级成 exec。**否决——T29 为 scope 以同样理由否决过。调用方在 live 驱动下要了一个模型；安静地回答另一个问题比拒绝更糟，而拒绝会点名两条出路（关掉 live，或去掉模型）。

**把模型放在 `SubagentStartRequest` 那个 seam 上，而不是暂存的 intent。**否决：那个 seam 是宿主的、与所有 provider 共享，而家族把自己的启动事实（cwd、exec、scope）放在暂存 intent 上，正是为了这个。模型是又一个家族私有的启动事实。

**让 `effectiveSettings.model` 在有委派模型在飞时报那个值。**否决：这个字段为条件快照回答一个 harness 级的问题，一个按委派变化的值会让同一家的两份快照因为条件哈希看不见的原因而互相矛盾。

**给 dsh 一把 `model` 键但不加 `--model`，把它映射到宿主实例的默认选择上。**否决：那会让一次委派的设置改变整个宿主实例跑什么——连同其他家条件的轮次和用户自己的前台 agent。

**让 eval 保持只比对，用「给判官改声明」来修 T22 第 5 步。**否决：那正是当时试过的，结果是 JUDGE_IS_PLAYER 撞车。声明必须可执行，那条约束才是关于评测的，而不是关于这台实例的。

## Consequences

声明了模型的条件现在会**改变跑什么**，而从前它只是描述。声明写错的 run 从前会在回读处失败，现在会直接跑那个被声明的模型——这正是目的，但也确实意味着一条写错的条件会安静地得到它要的东西，而不是大声失败。回读仍然抓住真正要紧的那种情况（harness 跑了别的）。

`resume` 多了一处抛错。从前往 `resume` 传 `model` 的调用方不可能有什么意图（这个选项当时不存在），所以树内没有东西会坏；照新选项写的调用方会在第一次尝试时撞上这个错误。

dsh 的 `--model` 绑定整个 `--serve` 进程。父侧从不要求它做别的（委派模型在 live 路径上被拒），但手工跑 headless bundle 的人应当知道：serve 模式下这个旗标是进程级的。

四家的模型管路现在是齐的：同一个调用选项、同一套取值顺序、同一个记录字段、同一条 exec-only 规则。剩下的不对称是**词汇**——dsh 把模型写成 `provider/model`，三家 CLI harness 各收各自 CLI 收的那种 id——而这是有意的：各家用自己的名字，绝不归一。
