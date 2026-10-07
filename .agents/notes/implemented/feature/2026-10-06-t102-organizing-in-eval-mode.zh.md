# Agent Note: 题集整理并进评测模式

Status: implemented

## Problem

T90 把题集整理做成单独的 Agent 预设「题集整理」（`dataset-authoring`），两种部署形态都有：web-eval 包，以及 3080 跑的已发布 dsh-presets 包。理由（[T90 决定 B](2026-10-01-t90-dataset-journey.zh.md)）是隔离：整理 Agent 会读答案，评测会话绝不能继承那份上下文。实际用下来，拆开的代价大于它保护的东西。选手能看到什么由题集分层和编排器强制，与规划 Agent 读过什么无关。拆开之后，人面对两个都「处理评测数据」的模式，常常选错，从「整理这个文件夹」到「在它上面规划一次运行」还得换会话。整理预设带着冻结决策 12 不让评测预设带的 shell，这正是两者合不成一个的唯一原因。

## Decision

只有一个评测模式。它规划和分析评测，也把数据整理成题集。

### 合并后的组合

- **web-eval `preset-eval`** 与 **dsh-presets `preset-dsh-eval`** 加上 `preset-dataset-authoring` 原有的几行：`tool-bash`（Windows 上禁用）、`tool-pwsh`（只在 Windows 上启用）、`tool-web` 带 `fetch: true`。仍然没有工作流引擎、ptc、ralph 和 plan-mode 行。
- **datasets 工具行改用 `organize` 档。** 这一档重新定义为 `authoring` 加 `datasets_propose_registration`。它注册 `dataset-authoring` skill，贡献一段合并后的提示 `datasets:organize`，既讲读已登记的题集，也讲写新题集。`all` 不变，仍然没有提交登记申请的动词。T102 之前 `organize` 的意思是「authoring 加 skill」，提交动词是只给整理预设的另一项授权。并进同一档后，「能整理」成了一个可检查的事实。
- **两个 skill 都在。** `eval-tool` 行（`all`）带 `eval-planning`，datasets 行的 `organize` 档带 `dataset-authoring`。
- **一份人设。** 开头说明 Agent 是什么（「You plan and analyze evaluations, and you organize data into datasets」）。保留对 docker 边界要紧的那一句——「Execution belongs to the deterministic orchestrator … Never start a run or control a container yourself, through the shell or otherwise — ask the person to run what needs running」——以及 T82 那句「已登记的题集就是 `datasets_list` 返回的那些」。整理一段让 Agent 先加载 dataset-authoring skill，带 dryRun 跑提交直到通过，再正式提交并停下。人设里没有别的禁令，防护看观察结果再定（见下文）。
- **登记表仍只由人写**（T90 决定 A）。Agent 只提交申请，人在「题集」页签上确认。
- `scripts/eval-preset-parity.spec.ts` 仍钉住两份相同。现在只比一对，并新增一个测试，断言两边都不声明 `dataset-authoring`。`scripts/web-eval-preset-bundle.spec.ts` 重钉了包的 sha。

### 取消「题集整理」

两行 `preset-dataset-authoring` 都已删除。dsh-presets 的 `PRESET_IDS` 是 `dev`、`dsh-eval`、`dsh-writing`。模式列表里不再出现这个模式。

**已有的 dataset-authoring 会话不迁移，也没有兜底。** 恢复会话时，宿主的会话控制器会解析保存的预设 id（`composeAgent` 里的 `presets.resolve(id)`）。没有任何行声明的 id 会抛 `agent-preset/not-found`（「Unknown agent preset: dataset-authoring」），会话无法组装。对话记录仍在磁盘上，可以读。没有加兼容行：藏起来的行仍是带自己人设的第二个模式，正是 T102 要去掉的东西，而且官方宿主没有「把这个 id 当成那个 id」的接缝。这类会话很少（T90 在 2026-10-01 才上线）。补救办法是新开一个评测会话，指向同一个文件夹。

### 「添加题集 › 让 Agent 整理」按授权选预设

评测模式在不同部署里 id 不同（web-eval 是 `eval`，3080 是 `dsh-eval`），写死默认值总会在其中一处错。`authoringPreset` 的默认值改为 `''`，由 datasets Remote 的 `organizingSetup()` 在宿主侧解析：

1. 显式配置的 `authoringPreset` 原样返回。
2. 否则 `resolveOrganizingPreset`（`packages/datasets/src/organizing-preset.ts`）读宿主的 `agentPresets` 登记表。部署默认预设授予了 organize 档就用它，否则取列表里第一个没坏、授予了这一档的预设。
3. 没有任何预设授予这一档，或登记表读不了，就返回 `''`。客户端于是保留会话的默认预设，请求文本里仍点名那个 skill。

「授予」的意思是：预设组合里有一行启用的 `@khorsheed/dsh-datasets/tool`，配置为 `tools: organize`。判断会递归进 `cordis:group` 行，`disabled` 是 `!!js` 表达式时按启用算。判断放在宿主侧，是因为官方 `pluginInventory` 只按模块名列行，不带配置。档位属于配置，而挂 datasets 工具的预设都用同一个模块名。登记表的 `readDocument` 以 Loader 的 YAML 返回组合，这个包本来就在解析 YAML。

### 改写冻结决策 12

原文：评测预设不带 shell，所以 docker socket 只归编排器。

新文：评测模式带 shell。docker socket 仍然只归编排器，但这一点不再由预设保证，防护看观察结果再定。iterations.md 表格行、web-eval 中英 README、T90 决定 B、dsh-presets 注释都已换成新的说法。

### 观察点

协调者读评测会话记录来看两件事，不为此加代码。

- **评测会话里经 shell 跑的 docker 命令**：`docker`、`docker compose`，或任何碰 docker socket 的操作。
- **由 Agent 而不是编排器写到 `state/eval` 或 `state/mission` 下的文件。**

两者任一出现，就是设计防护（shell 黑名单、人设加一句或沙箱配置）的时机。用哪种防护按观察到的情况定。

## Alternatives considered

**保留两个模式，只修写死的 id。** 这样能保住 T90 决定 B 的隔离论证。没选，因为那个论证不成立：选手看到什么由题集分层和编排器强制，与规划 Agent 的上下文无关。保留两个模式也就保留了「我该用哪个模式」的困惑，而那正是 T102 的起因。

**为合并后的授权新开一档，`organize` 保持原样。** `organize` 只有一个使用者，就是被删的预设。新起名字会留下一个死档，每份文档还得区分两个几乎一样的授权。重新定义 `organize` 让档位仍是五个。

**在浏览器里选整理预设，照搬评测入口的 T97 规则。** 浏览器只有 `pluginInventory`，有行名、没有配置。判断「这个预设挂没挂评测行」够用，判断「挂的是哪一档」不够。宿主的预设登记表是唯一有配置的地方。

**按 id 约定选**（先试 `eval`，再试 `dsh-eval`）。更简单，但遇到第三种部署或改名的预设就坏，而且等于用列表写死了任务要求不能写死的东西。

**给 `dataset-authoring` 留一个隐藏的兼容行。** 能让旧会话恢复。没选，因为它让第二套人设和组合继续存在，要靠宿主不提供的机制把它从模式列表里藏起来，而能保护的最多是几天的会话。

**现在就加防护**（shell 拦 `docker`，或在人设里列禁令）。还没有证据说明带 shell 的评测 Agent 实际会做什么。闭着眼设计的防护要么松到没用，要么紧到连整理都做不成，而整理本来就要用 shell。先观察。

## Consequences

- 两种部署都只有一个评测模式。题集旅程（整理、提交申请、人登记、规划运行）都在同一个模式里完成。
- 评测模式有了 shell。docker socket 只归编排器，现在靠人设那一句和观察来维持，不再靠组合。这是有意从结构性保证退一步，观察点是把它挣回来的办法。
- 旧的 `dataset-authoring` 会话恢复时报 `agent-preset/not-found`，对话记录保留。
- 评测会话的工具变多：`bash`（或 `pwsh`）、`web_fetch`、`datasets_propose_registration`。
- 「让 Agent 整理」不需要按部署配置。部署里没有整理预设时退回默认模式，请求文本仍点名那个 skill。
- 测试：`packages/datasets/tests/organizing-preset.spec.ts` 用两份真实的包补丁跑选择逻辑。`packages/presets/tests/presets.spec.ts` 和两份脚本 spec 钉住组合（shell 行、两个 skill、organize 档、没有 dataset-authoring、开发和写作模式不带评测项）。
