# Agent Note: 能力哈希——让条件的 `preset` 可核对

Status: implemented

[English](2026-09-11-capability-hash-and-sub-dsh-preset.md) | 中文

## Problem

条件文档从契约写下的第一天就带着 `preset` 与 `skills.pack`，两者都进条件哈希。两者都从没被核对过。没有任何东西把 preset 写到哪里去过，也就没有任何东西能与它不符：两条只差 `preset` 的条件，账面上是两个受试对象，事实上是同一个受试对象跑了两遍。评测赖以成立的那句话——「这两格只差一个因子」——压在一个没有对应物的字段上。

有三件事让它不只是「还没修」，而是「修不了」。

**目录只看得见一个 preset。** `capability-catalog` 的 snapshot 通过 `agentPresets.standingKeyFor(agentPresets.defaultId)` 解析 scope——永远是部署默认那个。`standingKeyFor` 本来就接 id，只是目录从没传过。「preset X 能做什么」这句话问不出口。

**清单不是身份。** 就算只看默认 preset，snapshot 也是按注册序排的，带着给人读的描述和文件 mtime，没有任何摘要。能力完全相同的两个实例给出不同的清单；一个只改了工具描述措辞的实例也给出不同的清单。里面没有任何东西能当因子用。

**preset 够不到受试对象。** preset 管的是**评测实例自己**的规划 agent 及其进程内子 agent，够不到被委派的四家 CLI 中的任何一家。而 sub-dsh——四个受试对象里唯一一个由本家族亲手写出 composition 的——根本不组 roster：headless bundle 的 agent loader 从全局层读模型面的行（`local-agent-dsh-headless/src/agent-loader.ts`，「This bundle composes no preset roster」）。于是「同一 harness 两 preset」（pilot D）对任何受试对象都不成立，连我们自己造的那个也不成立。

## Decision

### 指纹住在 catalog 里，而且是一次**投影**

`hashOf(snapshot)` 是规范形的规范 JSON 的 sha256，而规范形是对 snapshot 的一次刻意投影：

| 行 | 进 | 不进 |
|---|---|---|
| skill | `name`、`source`、SKILL.md 正文的 sha256 | `description`、`whenToUse`、`provider`、`updatedAt` |
| tool | `name`、`channel`、`parameters` | `description`、`confidence`、`owner` |
| mcpServer | `name`、它的工具**名单** | 工具数 |
| channel | 名单 | 计数 |

每个列表按 name 排序，注册序动不了摘要。排除项才是这个决定的实质：**措辞不是能力。** 改一句工具描述改的是模型读到的字，不是它能做的事；一个「改错别字就换个值」的因子在一次 run 里按不住。技能**正文**相反——它就是模型加载技能后执行的那套流程——所以以 sha 进入，而不是跟其余文字一起被排除。`updatedAt` 是文件系统事实：碰一下文件不该新造一个受试对象。MCP server 交的是工具**名单**而不是计数，因为「换掉一个工具」会保住计数、改掉能力面。

哈希写作 `caps:<sha256>`。snapshot 自己的 `sha` 字段不进它摘要的那份规范形，所以算哈希是幂等的。

### 两个动词，一个出清单，一个出身份

`snapshotFor(presetId?, workdir?)` 是指纹动词：解析 `standingKeyFor(presetId ?? defaultId)`，按该 scope 读 skill 与 tool 注册表，加载每个技能正文使行带上 `bodySha`，并盖 `sha`。`snapshot()` 仍是清单动词——同样的行，不读正文，不出摘要——因为设置卡要的就是一份清单，为了画一张网格而每个技能多读一次注册表，这笔开销没有买主。`list_capabilities` 以 `capabilities` 带回**整面**的标签，即使调用方只要了 skill 或只要了 tool：标签命名的是这个实例，不是别人向它提的那个问题。

**清单降级，指纹拒绝**（`resolvePresetScope`）。preset 的 scope 解析不出来时——没有 roster、id 不存在、composition 挂不起来——`snapshot()` 退回全局层并且**不带** `preset` 标签：设置卡不该因为一行配置坏了就变空，而一份不带标签的全局层读数是诚实的。`snapshotFor()` 则抛错，带上 preset 名与原因。这条规则写下来，是因为本次改动的第一次真机跑：一个 preset 只错了一行 persona 配置，降级版本让两个 roster 着**不同** preset 的 scope 拿到同一个哈希，还各自贴着自己 preset 的名字，全程无声。会降级的指纹不是「弱一点的指纹」，是**假的**指纹。

两处代价明说而不藏：算指纹时每个技能多读一次正文；问一个还没人组过的 preset 会把它**挂起来**——roster 的 standing mount 本来就是「该 preset 的 scope」这句话的全部含义。

### sub-dsh 的作用域目录成为它的能力面

`provisionDshSubProfile(homeDir, { preset })` 往子 profile 的 `cordis.patch.yml` 追加一条 patch 操作：一条 `insert` 行挂 `@deepseek-ai/dsh-agent-presets`，`default: <id>`。headless 的 agent loader 在 `setup` 里 join 它（`joinSubDshPreset`），在 agent 发布之前——因此 preset 的工具与提示词片段在第一次组装提示词之前就在位。不带这一层就什么都不变，与无 roster 时逐字节相同，这对一个本就没有 roster 的 composition 是正确答案。

preset 目录从哪来这件事不需要新机制：子 dsh 以 `DSH_HOME` 指向作用域目录启动，所以 roster 自带的用户根就是 `<作用域目录>/.agent-presets`。把一份 preset 目录放在那里，这个 scope 就有了自己的 preset。

生成出来的那一层同时是**可解析的**一层：`readSubProfilePreset(homeDir)` 从文件里把 id 读回来，因此「这个 scope 跑哪个 preset」不启动任何东西就能回答。

### 契约：谁可以声明 preset，以及必须有什么撑着它

- **`PRESET_CAPABLE_HARNESSES = ['dsh']`。** preset 是本家族配出来的一份 composition，而 sub-dsh 的子 profile 是它唯一会写的一份。给 `codex` / `claude-code` / `kimi` 写 preset 是 validate 的 **error**（`PRESET_NOT_FOR_HARNESS`），不是 warning：它会往条件哈希里塞一个没人写、也没人能核的因子。未知 harness 不管——降级，不爆炸。它们那侧的等价物 `skills.pack` 本家族同样没配，留 I6，错误信息里写明了。
- **lock 的 `provisioned` 里多两个字段**（协议 **v1-rev10**；在 T31 那个增补块里再增补）：`preset` 从写出去的子 profile 回读，`capabilities` 带 `{sha, preset?, skills?, tools?}`。记它们的是 `conditions provision`——T31 的写入者，仍然是唯一的那个——作为它的第 5 步。**测量本身是一个钩子**（`ProvisionOptions.capabilities`）：量一份子 dsh 的能力面要把它的子 profile 启起来、问挂在里面的 catalog，那条启动路 provision 刻意不拥有。没给钩子时，声明了 preset 的条件照样落 lock（作用域确实核对过了），但不带能力记录，并按名报 `CAPABILITIES_UNMEASURED`；之后就绪检查再拒一次。两头都出声，好过一份读起来「已核对」的 lock。
- **记测到的，不记声明的。** 探针报出的 preset 与条件声明不一致时，lock 记**测到的**那个并报 warning——记声明等于抹掉「两者不一致」这唯一的证据。
- **就绪检查拒绝没有对应物的声明。** `capabilityRefusal` 跑在探针委派之前：声明了 preset 而没有能力记录的条件不就绪（`the capability face was never measured`），记录取自另一个 preset 的同样不就绪（`the provisioned environment belongs to another subject`）。它不花 token——读的是 lock，不是机器——而它与委派探针并排，是因为两者回答的是同一个问题：这个受试对象是不是声明里那一个？

### 编排实例自己的哈希是取证，仅此而已

`run.meta.orchestrator.capabilities` 记编排实例自己的能力面：`{sha, preset?, skills, tools}`。报告的「程序一致」把它列出来，不拿它比任何东西。编排器不回答题库的任何一道题，把它的能力做成通过/不通过的输入，等于在一个受试对象根本没变的 run 上，因为「我们升级了规划 agent」而判一条不变量违反。组合里没挂 catalog 就不记这一行；catalog 抛错也不让 run 付任何代价。

### eval 不算能力哈希

eval 不 import 任何兄弟 `@khorsheed` 包，所以它只记摘要、从不重算：规范形是 catalog 的契约。`canonicalJson` 在两个包里各有一份逐字节相同的实现，由各自的测试钉住——这是独立性规则买来的那份重复。

## 真机验证

一套私有工具链（npm 装 `@deepseek-ai/dsh@0.1.5-rc.1`，两个本仓包以本地 tarball 解包进去，确保所有模块从**同一份安装**解析），scratch homes 根下三个 sub-dsh 作用域目录，各由 `provisionDshSubProfile` 配出。三个 scope 的 `cordis.patch.yml` 只差一行——roster 的 `default:`。三份子 profile 里都（同样地）挂了 catalog，由一个零 import 的探针行读出能力面：面来自真实启动起来的 composition，且不花任何模型调用。

| 核对 | 结果 |
|---|---|
| 两份 roster，两张面 | `eval-lean` → `caps:b140934bbc4b…`，技能 `[eval-planning]`；`eval-full` → `caps:3f3b4e781741…`，技能 `[eval-analysis, eval-planning]` |
| preset 的**名字**不是能力 | 第三个 scope 把 eval-lean 的内容换名为 `renamed-lean`，哈希 `b140934bbc4b…`——与 scope A 逐字节相同 |
| 改描述不动哈希 | 就地改掉技能的 `description:`，仍是 `b140934bbc4b…` |
| 改正文动哈希 | SKILL.md 正文改一句，变为 `4b8346cf27b8…` |
| 指纹拒绝坏掉的 preset | 一行 persona 配置写错时：`snapshotFor` 抛 `cannot fingerprint preset "renamed-lean": … failed to mount`，而 `snapshot()` 正常返回全局层清单、`preset: null` |
| roster 从安装锚点解析 | 三份子 profile 里都没有 `@deepseek-ai` 软链；`@deepseek-ai/dsh-agent-presets` 与 `dsh-base` 一样从 dsh 安装里加载 |

真机立住了两件单元测试立不住的事。其一是上面那条降级/拒绝的缺陷——只有当「本该不同的两个 scope 并没有不同」时才会被发现。其二：**preset 在 sub-dsh 上拿不走能力**。`dsh-base` 把整套模型面工具挂在 profile 根上，而 preset 是往上**组**行，不过滤根。两个 scope 的 26 个工具完全一样，两张面的差别落在各自 preset 注册的技能上。所以 pilot D 的两条条件差在各自 preset **加了什么**——这是一个真实的因子，也是这套装置今天能诚实给出的那一个，但它不是「同一 harness 换一套更小的工具集」。

**没有跑的那一项**：给每个 sub-dsh 委派一轮问「你有哪些工具」。本机在生产 home 之外没有 DeepSeek 凭据，而生产 home 不在本任务范围内。探针读的是那一轮本来要描述的同一张能力面，来自同一个启动起来的 composition，比模型的自述更精确——但它没有证明模型的提示词组装看得见它，这一点本次未验。

## pilot D 现在能说什么

「同一 harness 两 preset」现在是一句关于 sub-dsh 的话：两条 dsh 条件、两个 scope、两份子 profile roster，其余全同。两份 roster 出两个能力哈希，两个能力哈希就是两个受试对象。这也是本决定唯一支持的那个形状——preset 仍然够不到三家外部 CLI，而在 `validate` 里把这句话说出口，正是这套装置停止做相反承诺的方式。

## Testing

- `capability-catalog/tests/capabilities.spec.ts`：规范形每类行的取字段、排序、正文 sha 与参数 schema 缺席时的 `null`、MCP 工具名单；四条稳定性主张（同内容不同注册序同哈希；改工具描述与碰 mtime 不动哈希；改 parameters 与改技能正文动哈希）；对已带 `sha` 的 snapshot 幂等；摘要逐字等于规范 JSON 的 sha256；以及 `catalogSnapshot` 的两种模式，含注册表拒绝加载的技能。`resolvePresetScope` 覆盖清单/指纹的分岔：标签只在 scope 真解析出来时才贴、三种降级形状、三种严格拒绝，以及无 roster 的组合仍可为其默认面出指纹。
- `local-agent-dsh/tests/provision.spec.ts`：不给 preset 就没有那一层；追加的 `insert` 操作与 bundle 自己那份列表原样留在前面；两个只差 preset 的 scope 出两份 patch；显式 roots 与两个派生根开关；被拒的 preset id；幂等；子 profile 里**不**链任何 `@deepseek-ai` 副本（roster 是官方包，链第二份会带进第二份 cordis）；以及撤掉 preset 后那一层原样消失。
- `local-agent-dsh-headless/tests/preset-join.spec.ts`：join 与它报出的 id、两种 no-op 形状、以及拒绝的 roster 向上抛而不是降级。
- `eval/tests/capabilities.spec.ts`：三家外部 CLI 各自的 `PRESET_NOT_FOR_HARNESS`，以及 dsh 与未知 harness 上它的缺席；`conditions provision` 记下测到的面、再经 `resolveConditionReadiness` 读回；没声明 preset 的条件是**沉默**而不是 `preset: null`；无钩子与钩子抛错两种 `CAPABILITIES_UNMEASURED`；「记测到的不记声明的」；`capabilityRefusal` 的四种情形；以及 `checkReadiness` 用一个「`start` 被调用就抛」的门面证明未测量的 preset 不花委派。
- `eval/tests/run.spec.ts`：`run.meta.orchestrator.capabilities` 每 run 记一次、无 catalog 时不记、catalog 抛错时 run 照跑。
- `eval/tests/report.spec.ts`：「程序一致」里的 caps 行，以及没记过的 run 上它的缺席。
- `eval/tests/protocol.spec.ts`：v1-rev10 的 lock schema 对两个语种的协议文档，外加第二份公开的 lock 例子（一条已配好的 sub-dsh 条件）钉到它自己的夹具。

## 与 T31 的合并

T31（`conditions provision`）在本分支在途时合入了 main，两件任务都伸手去动 lock 的 `provisioned`。合并方式是显而易见的那一种，记在这里是因为未来的读者会在同一个对象里看到两件任务的字段：T31 拥有**写入者**与该块的必填字段（`at`、`cliVersion`、`effective`——作用域的回答），T32 往里加两个可选字段（`preset`、`capabilities`——那份环境组出了什么）。本分支自己那份草稿写入者（`conditionLockOf` / `writeConditionLock`）是**删掉**而不是合进去的：只有一个写入者正是 T31 的全部要点，第二个会让一份 lock 绕开凭证与 effective settings 的核对——而正是那些核对让第一个值得信。

## Alternatives considered

**把规范形放在 eval 里，由它对 catalog 的 snapshot 算哈希。** 否决。那样 eval 会拥有一份它并不定义的类型的投影，日后 catalog 每加一个字段，都会视乎哪个包被更新过而悄悄进或不进摘要。能力面属于产出它的那个包；eval 记它被递过来的摘要。代价是一份重复的 `canonicalJson`，九行，两侧各有测试钉住。

**把工具描述放进哈希。** 否决，而且这是最可能被重新翻出来议的一条。描述**确实**是模型看得见的一部分，排除它意味着两个实例可以哈希相同而提示词不同。但因子存在的意义是在一次 run 里按得住，而描述被改个不停——升级改、错别字改、翻译改。一个「改一句话就换个哈希」的值会在每次发版都报告一批新受试对象，而这种报告的诚实读法就是无视它。工具真正的契约在 parameters 上，parameters 进。

**为了与描述对称，把技能正文也排除。** 否决。技能正文不是「关于能力的文字」，它**就是**能力——模型加载技能后执行的那套流程。排除它等于允许一条条件把技能整篇换掉还保住身份。

**让 `snapshot()` 无条件出指纹，只留一个动词。** 以开销为由否决，差距不大。算指纹要经注册表读完每个技能正文；设置卡画的是网格，一个都不需要。两个动词共用一个实现体，既让清单那条路和过去一样便宜，也让指纹诚实地承认它为什么贵。

**靠启动子 dsh 来算它的能力哈希（`dsh --profile <sub> --capabilities`）。** 刻意押后。这是最忠实的测量——sub-dsh 真正的 composition 是 dsh-base 加 headless patch 加 roster，编排实例并不复刻它——但它需要一个新的 headless 启动旗标、一份 JSON stdout 契约，以及把 `capability-catalog` 挂进子 profile。本次交出的是**接缝**：`snapshotFor(presetId)` 在了，lock 字段在了，就绪检查在了，怎么测量由 `conditions provision`（T31）决定。接这条线的人请先读这一段：哈希的含义取决于它是在哪份 composition 里取的，取错了 composition 的哈希比没有更糟。

**把 sub-dsh 的 preset 做成 `local-agent-dsh` 的插件配置键。** 否决：插件配置是实例级的，而整件事要的恰恰是**按 scope** 的 preset。roster 经已导出的 `provisionDshSubProfile` 写入，由掌握按条件信息的调用方发起；harness 自己的 `provision` 钩子照旧不带 preset 地调它，缺省 scope 因此一字未改。

**外部 CLI 的 preset 报 warning 而不是 error。** 否决。warning 适配的是「还没解析」；这一条是「本装置永远解析不了」。字段照样进条件哈希、照样把一个受试对象劈成两个，而作者从一份他们本来就一划而过的 warning 列表里学不到这件事。

**preset 没对应物时拒整个 run，而不是拒那条条件。** 否决：就绪闸的粒度本来就对。失败的条件默认就会拒掉 run，而带 `--ignore-readiness` 时它的格子记 `cell-skipped`——这正是留给「知道自己在干什么」的运维的既有出口。

## Consequences

- 条件从此可以声明一个「有东西能与之不符」的 preset，pilot D 也有了一个对真实受试对象成立的形状。
- `CatalogSkillRow` 多 `bodySha`，`CapabilityCatalogSnapshot` 多 `sha` / `preset`；三者皆可选，既有读者不受影响。
- 协议走到 **v1-rev10**。给 lock 加 `provisioned` 不改任何条件哈希——lock 本身不进哈希——所以单凭这次改动没有任何既有条件需要重新 provision。给条件**加** `preset` 会改哈希，那是既有的「加因子即重新 provision」规则。
- 任何已经在外部 CLI 上写了非 null `preset` 的条件现在校验不过。题库里没有这样的条件；这条拒绝是未来的作者会拿到的东西，代替一句无声的虚构。
- sub-dsh 不组 roster 时什么都没失去，而「不组 roster」在各处仍是默认。
- **preset 在 sub-dsh 上拿不走能力。** `dsh-base` 把模型面工具挂在 profile 根，而 preset 是往上组行、不过滤根，所以两个 sub-dsh preset 的差别在于各自**加了什么**。pilot D 的两条条件因此是「同样的工具 + 不同的技能」，不是「更小的工具集」——是真因子，也是这套装置今天能诚实给出的那一个。要能收窄 sub-dsh 的工具集，得把 `dsh-base` 的模型面行搬进 preset，那是宿主侧的改动。
- 测量本身——一份子 profile 的能力哈希在真机上究竟怎么取——归 T31；本 note 的 alternatives 一节记下了它必须遵守的约束。
