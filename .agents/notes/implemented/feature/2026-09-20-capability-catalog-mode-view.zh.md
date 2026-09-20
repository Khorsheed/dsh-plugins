# Agent Note: the capability catalog's mode view

Status: implemented

## Problem

`@khorsheed/dsh-capability-catalog` 过去只在一个读位置读 skill 与 tool registry：**部署默认 agent preset 的 standing scope**。设置面板一直展示的就是这个视图；`snapshotFor(presetId)` 早就存在于**指纹**那条路上（让 eval 条件声明 `preset: X` 时可以被核验，而不是被相信），但浏览器半边从来没机会去问它。

用户真正会问的是比较性的问题——这个工具/skill 会在哪些模式下被加载?本改动所针对的实例用七个 preset 组合会话（标准 / PTC / 极简 / 创造，加上 开发 / 评测 / 写作），只在其中一个里注册的能力，在默认模式的网格里是看不见的。在旧 UI 里，这和「哪里都没有这个能力」无法区分：面板说不出「它存在，在那个模式里」。

## Decision

工具与技能面板在搜索/排序控件旁边多了一个**模式选择器**，每个 agent preset 一项，外加一个对比项；背后是两个新的 Remote 动词。

### `snapshotAt(presetId?)` —— 单个模式 scope 下的清单

`snapshot()` 原本是 `collect(undefined, workdir, false)`：默认 preset 的能力面，以清单形式。`snapshotAt(presetId)` 就是同一调用、把 scope 显式命名。清单/指纹的分野原地不动——`snapshotFor` 仍是唯一会读完每个 skill 正文并盖上 `sha` 的动词，因为视图要的是 registry 能多快给出的行。

解析不到所请求 preset 的读，降级方式与 `snapshot` 完全一致：全局层，且**不带 `preset` 戳**。于是这个戳就是 UI 的诚实信号——卡片渲染「该模式当前无法加载…显示的是全局层」，而不是把回退结果冠上那个模式的名字（`modeFellBack`）。

### `modeFaces()` —— 一次调用读完每个模式

`src/modes.ts` 拥有整个答案，且对输入是纯函数：`modeOptions` 投影 roster（保持它的顺序、标出 `defaultId`），`readModeFaces` 为每个选项读一个能力面。服务提供 reader；一旦读回来的 `preset` 戳不是它所请求的 id，reader 就返回 `undefined`——降级的读因此变成 `unavailable`，绝不会变成一个空面。

两件事刻意不合并：

- **坏的 preset** 根本不读（discovery 已经拒绝了它，挂载尝试纯属浪费），保留自己的行并带上原因；
- **读不出来的 preset** 同样保留行并带上原因。

「这个模式什么都没有」和「这个模式读不出来」是两回事，把两者合并的并集会低估某个能力实际可用的范围。客户端半边的 `buildModeComparison`（`src/client/mode-model.ts`）把读不到的模式排除出并集、单独上报，并在默认模式也有该能力时优先采用**默认模式的那一行**——否则卡片的文案会取决于 roster 顺序。

### 代价是刻意付的

解析 preset 的 standing scope 会**挂载**它的组合（roster 的 single-flight standing mount）。没有更便宜又诚实的来源：组合文件只写一个模式**点名了哪些插件**，不写这些插件跑起来注册了哪些 tool 和 skill；而可能近似这条路线的 origin 标记只覆盖打了标的插件工具，skill 一个都没有。所以保证在于**由谁付**：

- 默认模式在实践中早就挂着（当前会话跑在它上面）；
- 唯一会组合「从没挂载过的 preset」的路径是对比，它是选择器里的一次显式选择，旁边的说明也写着这一点。

### 读位置跟着卡片走

`detail`、`readSkillFile`、`deleteSkill` 都多了一个可选 `presetId`，卡片传入它被打开时所在的模式（对比视图里则是：默认模式有这个能力就用默认模式，否则用第一个有它的模式）。同名 skill 在别的模式下可能解析到另一个技能包，因此一个悄悄用默认模式的详情读或删除，会作用在错误的文件上。

### 网格就是一个模式的能力面，不合并任何东西

preset-scope 投递那次工作把「当前 scope 里没有、但受管根里有」的行合并进了同一张网格，好让它们在一处就能管理。那让网格变成了一张管理视图，而模式选择器把这个合并变成了缺陷：带着 `presetScope: [dsh-writing]` 的 skill 会出现在开发模式下，标签页的计数也是并集而不是这个模式的能力面。

现在网格就是 `snapshotAt(选中的模式)`，仅此而已；受管 skill 通过选中加载它的模式（或对比视图）即可到达。两个后果是刻意的：

- **没有声明 `presetScope` 的受管 skill** 投递给每个 preset，所以它本来就在每个模式的能力面里——不需要任何特例；
- **没有任何可读模式能加载的 skill**（范围指向本部署没有的 preset、该 preset 解不出 standing scope、或投递被同名副本拒绝）不属于任何能力面。只做过滤会让它**够不着**而不只是隐藏——看不见的受管 skill 无法释放——所以技能页把这类行放在一条诊断线下，点开详情就能改范围。`orphanManagedSkills` 只用投递状态与 roster 判定成员资格，不需要能力面。

卡片**徽标**回到来源（插件 / 内置 / 用户 / 项目 / 自定义）。受管 skill 的 `preset` 范围是策略不是来源；它只出现在"范围就是主题"的地方（未生效清单、详情弹窗），而不是出现在一张问"这个模式加载什么"的网格里。

### 详情弹窗在选择器回答不了的地方回答同一个问题

插件提供的 skill 没有 preset 编辑器，弹窗的范围区块原本只能停在一句"由插件决定"。现在它还会列出实际加载该 skill 的模式，取自对比视图共用的 single-flight `modeFaces()` 缓存——对比过的面板秒答，首次打开则会把未挂载的 preset 组合一次，供之后所有调用共享。点 chip 会关闭弹窗并切换网格，因为弹窗描述的就是它被打开时的那张网格。

### 对比视图的 chip 密度

七个模式时逐模式排 chip 会变成两行药丸墙。三种形态覆盖：**每个可读模式都加载** → 一颗 `全部模式 · 7`（最强也最频繁的答案，这种情形下列举模式名毫无信息量，名字仍放 title）；**少数** → 直接显示 chip；**部分但很长** → 前两颗 + `+N`，`+N` 就地展开（只给 title 能回答"还有哪些"，却点不进去，而这排 chip 的全部意义就是跳转）。

## Alternatives considered

**不挂载，改从 `compositionInventory()` 推导能力面。** 官方的「会话插件」面板就是这么回答邻近问题的，而且它什么都不组合。但它回答的是另一个问题：它列出 preset **点名了哪些插件行**，而不是那些插件注册了哪些能力。要把插件行反查回能力，需要每个能力有 owner——origin 标记只覆盖打了标的插件工具，skill 则完全没有 owner——于是答案会是「一部分归因」被当作完整归因呈现。否决：这个功能存在的意义就是权威地回答 tool/skill 的归属。

**打开面板就急切地读完每个模式，让 chip 永远都在。** 对网格是否决的：那会因为「有人打开了设置页」而把部署里每个 preset（连同它的 watcher 与连接器）都组合一遍。对比只差一次点击，而且它会说明自己的代价。（详情弹窗的模式清单确实会打开即读，但只在问题原本无解的地方——不可写的 skill——而且有会话级 single-flight 缓存兜着。）

**保留合并进来的受管行，只标上"本模式未生效"。** 同一张网格里的第二类卡片仍然让计数和"这个模式加载什么"的答案失真，读者还得先学会哪些卡片算数。否决，改用一张每行都回答模式问题的网格 + 一条针对"任何模式都看不到"的独立诊断。

**只做模式切换器，不做对比。** 切换器回答「模式 X 有什么」；用户要的是「哪些模式会加载 X」。两者共用一个控件。

**改做每个能力的 `presetScope` 界面，而不是读位置。** 那东西对受管 skill 已经存在（投递策略），而且它主张的是**另一件事**：策略说的是某个 skill 被投递到哪里，模式视图说的是它实际在哪儿被找到。两者正好在有意思的时候不一致（冲突、坏模式、插件提供的 skill），所以卡片两个都显示。

**用 hover tooltip 代替 `+N`。** title 能说出隐藏了哪些模式，却无法导航过去，而这排 chip 的全部意义就是跳转。改用就地展开。

## Consequences

- `list_capabilities` 与 `snapshotFor` 未受影响：面向模型的工具仍在调用方 agent scope 里回答，指纹路径仍拒绝降级。
- 通过 UI 读一个 preset 可能把它组合出来。这是设置页第一次能产生的副作用；它被 roster 规模限定、每个进程只付一次，并被挡在显式对比选择（或"弹窗问一个不可写 skill"）之后。
- 组合里没有 agent-preset 服务（或没有 preset）时，模式控件不渲染——与范围选择器既有的降级一致。
- 对比的并集是可读能力面的**并集**，所以不被任何可读模式加载的能力**不在**其中；那种行归到未生效诊断里。并集也不再吸收受管合并，所以读者看到的计数就是并集自己的。

## Related

- [preset-scoped skills in capability-catalog](../../proposed/feature/2026-09-13-capability-catalog-preset-scoped-skills.md)——同一条轴上的投递策略一侧。
- [a preset scope only where the host will write one](../bug-fix/2026-09-20-preset-scope-editor-write-path.md)——这次工作在那个弹窗里顺手纠正的缺陷。
- [the skill detail modal's frontmatter block](../bug-fix/2026-09-20-skill-metadata-block-redundancy.md)——同一弹窗里那块原始 metadata 的收敛。
