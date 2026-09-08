# Agent Note: tool-subagent —— 委派工具的挂载期注册开关

Status: implemented

[English](2026-09-08-tool-subagent-tools-switch.md) | 中文

## Problem

装了 local-agent 家族的 profile，拿到的不只是一个委派 provider。每个 harness bundle 的 patch 都往 **profile 根**上插两行：provider，以及一行 `@khorsheed/dsh-local-agent-tool-subagent`，它带的是模型可见的那个工具——`subagent_codex`、`subagent_claude_code`、`subagent_kimi`、`subagent_dsh`。而这个工具，恰恰就是在宿主上起一家编码 agent CLI 的东西，沙箱取的是 provider 被 pin 成什么档。

对日常开发的 profile 来说，这正是它的用处。对评测实例来说，这是个洞。`dsh-web-eval` 冻结了决策 12——装置的销毁路径唯一，所以实例的 agent 不挂 shell、不挂容器控制——[eval 预设](../process/2026-09-08-web-eval-agent-preset.zh.md)是这条决策的执行点，它带的组成里把执行类的行都删了。可这四个预设够不到：预设只过滤自己挂的行，而这四行挂在它上面，在 profile 根。于是预设拿走了 `bash`，却留下四个各自能在宿主上起一家 CLI 的工具，沙箱还是 `sandbox: workspace-write` 或 `permissionMode: skip`。

编排器不需要它们。它经 local-agent 服务面驱动选手（`packages/eval/src/run.ts` 只用 `LocalAgentFace`，也就是注册在 `ctx.subagents` 上的 provider），`/codex login`、`/kimi status` 这些是 provider 自己的斜杠动词。评测流里没有一步经过这个模型可见的工具。

## Decision

插件配置新增 `tools`，默认 `all`：

| `tools` | 注册的工具 |
|---|---|
| `all`（默认） | 本行那一个模型可见工具——与本配置项加入前逐字节相同 |
| `none` | 无 |

`none` 下，`apply` 记一条「哪个工具没注册」的日志就返回，此外什么都不做：没有工具，也没有 `subagent/provider-added` / `subagent/provider-removed` 监听——那两个监听存在的唯一理由就是挂载和卸载这个工具。家族的其余东西都由 **provider 包**注册：harness、`ctx.subagents` 上的 provider、斜杠动词、`ctx.localAgent` 服务面——所以一个 `none` 的行，把通往那家 CLI 的每一条非模型路径都留着。两个取值下 `inject` 都不变。

**两个值，不是分组清单。** 每挂一行只注册一个工具，没有可分的组。`datasets` 与 `mission` 有分档的 `tools`，是因为它们各注册一打角色不同的工具；这里唯一的问题是模型到底看不看得见本行这个工具。

**开关只能落在包里。** 预设只在已注册的工具里挑，减不掉任何一个，而这些行挂在 profile 根、在每个预设之上。注册处是这个决定唯一能下的地方——[mission 的工具分组](2026-09-07-mission-tool-groups.zh.md)记的是同一条推理。

`profiles/web-eval/cordis.patch.yml` 给有配置行的那三行设了 `tools: none`——`tool-subagent-codex-local`、`tool-subagent-claude-code-local`、`tool-subagent-kimi`——作为冻结决策 12 的第三个执行点，前两个是「工具按域开放」与 `eval` 预设默认值。

**每一行都把整份 config 重抄一遍。** patch 层的 `config` 是整值替换而不是深合并（`vendor/include` 的 `applyEntryPatches`：`target[key] = value`），所以一行只写 `tools: none` 会把 provider bundle 写的 `provider` 与 `toolName` 一并抹掉，而 `provider` 是必填——整个组合会在 schema 校验上炸掉。因此每行都在 `tools` 旁边重抄 `provider` 与 `toolName`，并带上 `name:`：万一这个行 id 被别的插件占了，loader 报 name mismatch 并跳过，而不是把一份它读不懂的配置塞给它。`none` 下这两个键只用于满足 schema：插件在读到它们之前就返回了。

**第四个工具没有行可 patch。** `subagent_dsh` 是从 `local-agent-dsh` 内部挂的：DeepSeek 开关默认关，开关 ON 时控制器调 `ctx.plugin(toolModule, { provider: 'dsh-cli', toolName: 'subagent_dsh' })`，配置写死，profile 层够不着。默认状态下它一个工具都不注册，所以评测实例的工具清单里没有它——但人在设置里打开那个开关，就会拿到带默认 `tools: all` 的它。要关上这条路得把 `tools` 穿过 `local-agent-dsh`，本次刻意没做：委托这次改动的任务书把 provider 包划在范围外，而且 dsh 选手与另外三家一样经同一个服务面驱动，所以这个缺口是「人可以扳回来的默认值」，不是「agent 自己走得通的路」。两份 README 与 pack 的 patch 都在读者会遇到的位置写了这一条。

进程内的 `subagent` 与 `subagent_fork` 原样保留。它们继承父 agent 的预设，所以委派递不出预设本身没有的 shell。

## Alternatives considered

**在 pack 的 patch 里给四个工具行加 `disabled: true`**（[eval 预设那篇](../process/2026-09-08-web-eval-agent-preset.zh.md)记的三条路径里的第 2 条）。否决的是「把决定放在这里」，不是「这个机制不管用」：它管用，还不用改包。但它把意图写在了离被关掉的东西最远的一层——读工具包的人看不到任何痕迹说明「不注册」是一个受支持的状态，CI 里没有东西可测，而且以后每一个想要同样效果的组合都得手工重新推导行 id。配置项与它管的代码同版本、有测试；patch 行于是只说*为什么*，不说*怎么做*。

**在预设里挂一行调 `ctx.tools.restrict({ deny: [...] })`**（第 3 条）。否决：它是「预设减不掉 profile 层工具」的通解，但要新开一个包，而且被拒的名字不存在时它 fail loud——没装 codex provider 的实例会根本挂不起这个预设。它还按名字拒，所以工具改名时 deny 清单会悄悄漂掉。

**逐工具布尔或 `registerTool: false`。** 否决：同一个开关换个更差的名字。`tools` 与 `datasets`、`mission`、`eval` 已经在用的那个旋钮同名，于是 profile 作者在 `cordis.patch.yml` 的四类行上读到的是一套词汇，而不是同一个意思的四种拼法。

**`none` 下保留 provider 生命周期监听，让 mount 成为空操作。** 否决：那两个监听存在的唯一目的就是注册与注销这个工具。`none` 下留着它们，等于守着一个处理函数什么都不做的事件，而且「provider 出现时就会注册」那句日志会是假的。提前返回让这次挂载自己的日志成为真话。

**`tools` 为 `none` 时让 `provider` 变成可选。** 否决：换来三行更短的 patch，代价是 schema 失去意义——`provider` 会变成「必填，除了有时候」，而 `none` 行里拼错的 provider 名会被静默接受，直到有人把这行改回 `all` 的那天才炸。

**把 `tools` 穿过 `local-agent-dsh`，四家一起关。** 本次没做：委托任务把 provider 包划在范围外；而且如实记下「三个关了，第四个默认不挂、人有据可查的办法能打开」，好过悄悄声称关了一半。真要做时改动很小：一个配置键接到现有的 `ctx.plugin(toolModule, …)` 调用上。

## Consequences

- 默认挂载不移位：`all` 注册同一个工具，schema、描述、来源标签都一样，dev 域的 profile 升级后逐字节相同。
- 评测实例的 agent 没有通往宿主 CLI 的模型可见路径，而编排器通往同一批 CLI 的路径原样保留。这种不对称正是把开关放在注册处、而不是放在 provider 上的全部理由。
- **人在 tab 里也失去了一点东西。** 这些是模型可见的工具，所以人够到它们的唯一方式就是让模型去委派。在 `none` 的 profile 里，这个请求现在无处可去；人通往那些 CLI 的路径只剩 provider 的斜杠动词与编排器。在 eval 域这是有意的——模型在场是为了规划与分析——但这确实是一次能力削减，不只是防 agent 误操作的护栏。
- 任何覆盖这几行的层都必须重抄 `provider` 与 `toolName`，因为 patch 的 `config` 是替换而不是合并。这是 loader 的性质而不是本配置项的，但这是 pack 的 patch 里第一行「上游 config 非空」的行，所以是第一次咬人的地方。
- `subagent_dsh` 仍在默认关的 DeepSeek 开关后面可达。这一条记在上面、记在 `cordis.patch.yml` 里、也记在两种语言的 README 里。

## Testing

`packages/local-agent-tool-subagent/tests/tool-subagent.spec.ts` 在既有套件上加了三例（共 15 个测试，全绿）：显式 `tools: 'all'` 的注册与执行与默认完全一致；provider 已在场时 `tools: 'none'` 一个工具都不注册，且 `ctx.subagents.getProvider` 照旧；provider 在挂载**之后**才出现时 `tools: 'none'` 仍不注册——钉住 `none` 不会从 `all` 那一例依赖的晚挂载路径上重新打开。

端到端，在一次性 `$DSH_HOME` 上对 pack 做全新源码模式安装（23 个成员，160 条 patch 行）：`--dump-config` 显示三行都组合出了 `provider`、`toolName` 与 `tools: none`；capability-catalog 的 snapshot Remote——它读的是默认预设 standing scope 下的 `ctx.tools.schemas()`，即 agent 真正看得到的清单——返回 **36 个工具**，比 T21 时 eval 预设的 39 个少 3 个，差集恰好是 `subagent_codex`、`subagent_claude_code`、`subagent_kimi`，而进程内的 `subagent` 与 `subagent_fork` 仍在。同一个实例上 `/codex status`、`/kimi status`、`/claude-code status` 都报出各自 pin 的配置，`/eval run <plan> --dry-run` 校验了 plan、展开了矩阵、打印了执行顺序。

## Cross-references

- [eval 预设](../process/2026-09-08-web-eval-agent-preset.zh.md)——冻结决策 12 的第二个执行点；这个缺口与三条路径是它记下的，本篇取的是第一条。
- [mission —— 模型工具按挂载时的组注册](2026-09-07-mission-tool-groups.zh.md)——同一条「预设减不掉 profile 注册的东西」的推理，只不过那个包有一打工具，这个包只有一个。
