# Agent Note: one `model` key per local-agent harness

Status: implemented

[English](2026-09-08-local-agent-model-key.md) | 中文

## Problem

四家 local-agent harness 的模型各有各的来源，没有一个是人能从 dsh 这边够到的开关。

- **codex** 读作用域 `config.toml` 的顶层 `model`。
- **claude-code** 读作用域 `settings.json` 的 `model`；没配就是 CLI 自己的默认，
  插件从不猜它是什么。
- **kimi** 有 `model` 插件配置键，但它只在**首次预置**全新作用域目录时用一次：
  写进那份 `config.toml` 的 `default_model`，已存在的 config 不动。也就是说，
  凡是预置过的目录，这个键什么都不做。
- **dsh** 继承宿主实例的默认模型选择，provider 从不覆盖，快照报成 `provider/model`。

换个模型于是等于手工去改那家的作用域文件——dsh 还得改整个宿主实例的默认模型。
没有统一入口，设置页上也没有任何东西。

评测侧的约束本来就是对的，保留：冻结决策 5 要求声明模型 == 实测模型，条件哈希
含模型，run 中途换模型会让下一轮成为 `MisattributedRun`。

## Decision

### 三家 CLI harness 各加一个可选 `model` 键

`local-agent-codex`、`local-agent-claude-code`、`local-agent-kimi` 的插件配置各接受
一个可选的 `model: string`。

**"不写"这一支就是全部的兼容性故事。**没有这个键时，provider 往 spawn argv 上
**什么都不加**——每一种 argv 变体都与此前逐字节相同，跑哪个模型仍由该家的作用域
文件（或 CLI 自己的默认）决定，与从前一模一样。只含空白的值等同于没写，所以设置
卡上清空一个字段不可能产出一个空的旗标值。

**写了就是每轮委派以它起 CLI**——新起与续接（resume）同等对待，常驻（`live`）
与一次性同等对待。每家用自己 CLI 的机制：

| harness | 一次性轮次 | 常驻 runtime |
|---|---|---|
| codex | `codex exec -m <model> …`——`-m` 属于 `codex exec` 本身，因此排在 `resume` 子命令之前（`codex exec resume` 不声明自己的 `-m`） | `codex app-server -c model="<model>" --stdio`——那里没有 `-m` |
| claude-code | `claude -p … --model <model> …`，位置在成员通道那个变长的 `--allowedTools … --` 之前 | 常驻进程的 spawn 上同一个 `--model` |
| kimi | `kimi -m <model> -p <任务>`；resume 轮保持 `-S` 在最前、`-m` 紧贴 `-p` | `kimi acp` **没有**模型旗标：每次起 runtime 前改写作用域 `config.toml` 的顶层 `default_model` |

对照实机核实：codex-cli 0.144.0、claude 2.1.263、kimi 0.39.1。

kimi 的常驻路径是"哪家 CLI 没有按次启动的模型参数就写作用域配置"这条规则唯一适用
的地方。`writeKimiDefaultModel` 是就地且幂等的：只动第一个**顶层** `default_model`
赋值（`[models."…"]` 表内的同名键是另一个键），注释、模型表、provider、键序全部
逐字节保留；没有 config 的目录不新建——创建是预置逻辑的职责，在这里凭空造一份
会掩盖一个坏掉的目录。写失败该轮照跑，由模型回读负责暴露不一致。

### kimi 这个键的语义是有意改的

`model` 原本只在预置期生效，现在按轮生效。预置镜像行为**保留**——全新的、没有用户
config 可镜像的作用域目录，仍然按它写出最小 managed config——所以旧行为是新行为的
子集。两份 README 都写了这个警告。

### `effectiveSettings.model` 的读取顺序

插件配置键 → 该家的作用域文件 → 缺位。键在前，因为它每次启动都覆盖文件：报文件
就等于报了一个并不会跑的值。dsh 照旧报宿主 `agentDefaultModel` 的当前选择，不变。

### 设置卡「默认模型」

三家各一行 dev 域卡片：一个自由输入框，加上此前存过的值作为 `<datalist>` 候选，
外加一个保存动作。**任何地方都不硬编码模型目录**——插件里带一份模型 id 清单，
下周就过期了。保存写的是 YAML 配置作为组合基线所喂的同一个命名空间 `model` 字段，
因此改动不重载就抵达**下一轮**；清空字段是**取消**该键而不是存一个空串，于是重新
继承基线。最近五个值存在 `recentModels` 字段里。

### dsh 不给键

无头子 dsh 的启动面上没有可以按次指定模型的位置：
`dsh --profile headless-local-agent-dsh` 只接受 `--session-id`、`--resume`、`--serve`，
而 `loadSubDshAgent` 的模型取自它的 `agentDefaultModel` 选择。给这里加键就得先在
`@khorsheed/dsh-local-agent-dsh-headless` 里开一条按次传模型的路，本次改动有意不做。
dsh 换模型仍然等于"换宿主实例的默认模型"，README 明写。

### run 的冻结是设计，不是缺口

没有为"run 进行中改配置"新增任何守卫，也不需要：run 的条件在建立时冻结，下一轮的
模型回读会发现声明 ≠ 实测，直接判为 misattributed 而让 run 失败。"切了新 run 照新走、
进行中的 run 不被悄悄换掉"因此是既有机制自然的结果。四份 README 都把这一点写出来，
而不是留着让它看起来像漏掉了。

## Real-machine verification

本机每家跑两轮：直接驱动已交付的 provider 入口，对真实 CLI、真实作用域目录，
经 provider 自己的 settle 观测（`onRoundSettled.observedModel`）回读模型——评测拿
去和声明模型比对的就是这个值。第一轮写上键，第二轮清掉。

| harness | `model` 键 | 插件拼出的 argv | 回读到的模型 | 轮次结果 |
|---|---|---|---|---|
| codex | `gpt-5.6-luna` | `-m gpt-5.6-luna` | `gpt-5.6-luna` | completed |
| codex | 不写 | 没有 `-m` | `gpt-5.6-sol`（该目录自己的默认） | completed |
| claude-code | `claude-haiku-4-5-20251001` | `--model claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` | completed |
| claude-code | 不写 | 没有 `--model` | `claude-opus-5[1m]`（CLI 自己的默认） | completed |
| kimi | `kimi-code/k3-256k` | `-m kimi-code/k3-256k` | `k3-256k` | error——见下 |
| kimi | 不写 | 没有 `-m` | `k3`（该目录 `default_model = kimi-code/k3`） | error——见下 |

kimi 两行有两点要讲清。回读报的是 **provider 侧**的模型 id（`[models."kimi-code/k3"]`
里写的是 `model = "k3"`），不是配置键——这是 wire 日志回读一直以来的行为，本次没动。
以及两轮都 settle 成 `error`：该账号当月额度已用尽，端点回 403，而这发生在 CLI 已经
解析完模型并写下请求记录之后。所以模型选择是端到端验证过的，只是当天这台机器上拿不到
一次跑完的 kimi 回答。

dsh 没有 `model` 键，因此没有对应行：它的模型跟着宿主实例的默认模型选择走。

## Testing

每家：不写时的 argv 以完整数组断言等于旧形状（新起与 resume，claude 还包括两种
权限模式）；写了时旗标出现在它必须在的位置（`-m` 在 codex 的 `resume` 之前、
`--model` 在 claude 的 `--allowedTools … --` 之前、`-S` 在 kimi 的 `-m` 之前而 `-m`
在 `-p` 之前）；resolver 不重载即跟上后续的设置写入；空白值解析为未设置；以及
`effectiveSettings` 的三路顺序（键胜过作用域文件、无键时文件说了算、都没有则字段
缺位）。常驻路径每家也各自钉住：codex app-server argv 上的 `-c model=…`、claude
常驻 spawn 上的 `--model`、kimi 的 `default_model` 改写——包括"不写则作用域配置
一字不动"和"没有 config 的目录该轮照跑"。`writeKimiDefaultModel` 另有单测覆盖就地
替换、插入、无操作、无配置、TOML 转义。设置卡测试覆盖保存、去空格、清空即取消、
去重的最近值、候选只来自存过的值，以及未改动时保存按钮禁用。

## Alternatives considered

**四家统一改写作用域配置。**那样只有一套机制而不是两套。否决的理由是：一个按轮
的选择会因此去改一份用户拥有并手工编辑的文件——codex 的 `config.toml` 与 claude 的
`settings.json` 都是有文档、会被手改的面，每轮重写它们会让"我配了什么"和"上一轮跑
了什么"再也分不开。旗标覆盖则完全不碰文件。kimi 的常驻路径走配置改写，仅仅因为
`kimi acp` 没别的可用。

**在 local-agent 家族核心上做一个统一的模型设置，而不是三个键。**否决：核心自己
不 spawn 任何东西，三个 CLI 也不共享模型词汇——一个统一字段最后还是要按家翻译，
而评测钉的是每家的条件，不是整个家族。

**用模型目录做下拉框。**否决：插件里带的任何目录，下一次模型发布就过期，而一份
过期清单会悄悄挡住一个 CLI 本来支持的模型。自由输入加上"这台实例真正跑过什么"的
记忆，让插件不必去做模型命名这门生意。

**像 `sandbox` 那样在 apply 期取一次值。**否决：设置卡必须不重载即生效，因此模型
按轮经 resolver 读取——与 live 开关已有的形状相同。

**给无头子 dsh 加 `--model`，让 dsh 也有键。**本次否决：那是本分支范围之外的第五个
包，而且需要在子实例自己的模型选择上开一条按次传模型的路，不只是加一个 argv 旗标。
在此记录为 dsh 将来能拿到这个键的条件。

**run 进行中禁止或警告配置改动。**否决：条件哈希加模型回读已经会让这样的 run 大声
失败；加锁是一套新机制，且只守住模型能变的几条路之一（作用域文件仍然可以手改），
而 README 把既有行为讲清楚就够了。

**卡片字段清空时存一个空串。**否决：空串就是 argv 上一个名为 "" 的模型。清空即取消
该字段，于是组合基线——没有基线时则是"不写"的行为——接管。

## Consequences

在 YAML 里设了 `model` 的 kimi 部署会拿到一次行为变化：该值现在每轮都生效，而不再
只在首次预置时用一次。本仓库没有任何 profile 钉过它（web-eval profile 只设了 `live`
与 `thinkingEffort`），所以树内没有东西改变；真钉过它的部署会拿到它写的那个模型，
而这正是这个键看起来本该做的事。

kimi 的常驻轮次现在会写作用域 `config.toml`。写是幂等的、只限一行，但确实意味着
文件里的 `default_model` 会跟着最后一次常驻 spawn 走——读文件的人看得见，而且诚实：
它就是下一个 `kimi acp` 会跑的东西。

常驻驱动在 **runtime spawn 时**绑定模型，而非按轮：已经持有 runtime 的成员会保持
它的模型，直到该 runtime 被空闲回收、崩溃，或 live 开关重建了这一代。一次性轮次
——评测用的驱动，也是默认——每轮都取值。

评测包与 profile pin 未被触碰。评测实例要不要按条件钉模型，是另一个决定。
