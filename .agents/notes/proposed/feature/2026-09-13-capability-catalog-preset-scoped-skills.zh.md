# Agent Note: preset-scoped skills in capability-catalog

Status: proposed

## Problem

`@khorsheed/dsh-capability-catalog` 是本部署里安装和查看 skill 的入口：它的 Add-skill
流程把 `<name>/SKILL.md` 写进受管根（`$DSH_HOME/skills` 或 `.agents/skills`），设置页
（工具与技能）列出注册表当前持有的东西。用于写作的两个 skill——`md-to-wechat` 与
`tech-article-polish`——就是这样装的，落在 `$DSH_HOME/skills`。

它们在每一个挂了本地 skill provider 的 preset 里都可见。用户要的恰恰相反：**逐 skill、
多选的 preset 生效范围**，让某个受管 skill 只在选定的一组 preset 里生效——这里是只在一个新的
`dsh-writing` preset 里——且不编辑任何 shipped preset。

### 这些 skill 究竟从哪来

拓扑并不统一，这一点很重要：

- `packages/bundle/base/cordis.patch.yml` 注册了一个宿主级 `skill-filesystem` 行；宿主行
  落进 skill 注册表的**全局层**，而每个 preset 的读取都会合并全局层。
- Web 部署**禁用**了那一行以及宿主 `tool-skill` 行
  （`packages/bundle/web-app/cordis.patch.yml`："the base host `skill-filesystem` row is
  disabled here (presets own local discovery)"），而 `dsh-skill` 注册表本身仍留在宿主面。
- 于是在 Web 里 `standard`、`cordis`、`ptc` 各自把 `skill-filesystem` 挂进**自己那一层**，
  而这些行扫的是同一个默认用户根。因此这两个 skill 在任何挂了它们的 preset 里都出现——靠的是
  逐 preset 注册，而不是某一个全局行。
- `minimal` 完全没有 skill 行，所以今天它根本看不到它们。

两种拓扑都没有任何逐 preset 排除：`dsh-skill`、`dsh-skill-filesystem`
（`customSkillDirs` / `includeDefaultRoots` / `dshHome` 等）与 `dsh-tool-skill`
（只有 `catalogDescriptionMaxLength`）全树都没有 deny 名单、过滤器或可见性字段。

### 为什么在本插件里加一个配置字段解决不了

插件是注册表的**消费者**（经 `ctx.get` 用 `ctx.skills.snapshot()` / `ctx.skills.get()`），
不是贡献方。注册表只增不减：层做合并，近层压过同名。加在本插件 settings 里的字段只会改它自己
那个页签，模型看到的东西一点不变。

决定模型/用户能加载什么的面归别的包所有，且都没有过滤钩子：

| 面 | 拥有者 |
|---|---|
| 持久会话目录消息（`source.kind === 'skill-catalog'`） | `dsh-tool-skill` 的 pre-step |
| `skill` 工具 | `dsh-tool-skill` |
| 用户 `/name` 手势 | `dsh-tool-skill` 的 pre-step |
| 输入框 `/` 菜单 | `skills/list` Remote，`dsh-api-session-controller` |

## Proposal

分两条轨道交付，并且明确说清插件侧那条轨道**不是**什么。

### Track 1 — 上游 seam 才是真正的答案

通用能力（"任意 skill、任意 preset 子集、文件留在用户安装的地方"）属于宿主，而不属于一个目录
插件。让它成立的最小 seam：

- `dsh-skill` 给 provider 一个**已声明**的 view context，让 provider 不必从不透明的
  `ScopeKey` 里猜身份：要么把 provider 签名放宽成已经导出的 `SkillViewOptions`，要么新增一个
  只读的 view 记录，携带 `presetId`。
- `presetId` 必须由 roster/注册表针对真实的 standing generation 产出——不能由消费者遍历对象
  属性猜出来（见下面 "Scope of enforcement"）。
- 有了已声明的身份，过滤既可以落在 provider（本插件），也可以更好——落在注册表读取处：层本来
  就住在那里，而缓存键本来就已经包含 scope 链。

应另写一份 `docs/upstream-proposals/` 文档承载具体 API 草案，并在
`docs/upstream-seam-registry.md` 里登记。Track 1 是推荐路径；它不是下面那个即时需求的前提。

### Track 2 — 即时需求：零宿主改动、零新插件代码

对于"这两个 skill 只在我自己的 preset 里加载"，宿主已经有文档化机制，而且正是 shipped
`cordis` preset 在用的那一套：

1. 通过复制 `standard` 的组合来创建用户 preset（`$DSH_HOME/.agent-presets/dsh-writing/`）
   ——copy-only authoring 就是 roster 自己的 API；
2. 把写作 skill 移进一个**没有任何默认 provider 会扫**的根（preset 目录内部，或两个写作
   preset 共享的一个兄弟目录）；
3. 给该 preset 加一行 `skill-filesystem`，配
   `customSkillDirs: [<那个根>]`，并让 `includeDefaultRoots` 保持默认，这样该 preset 对其余
   所有 skill 仍保持标准模式的视野。

在此之上，"作者自己拥有的 preset 之间多选"就是一个被多份组合引用的共享目录。它诚实、有版本
语义、不需要插件或宿主改动。它做不到的是把 skill **授予 shipped preset**（`standard` /
`cordis` / `ptc` / `minimal` 只读且升级会覆盖），并且"逐 skill 的任意子集 × 很多 preset"会
退化成"每个子集一个目录"。

### Track 3 — 插件侧路线，明确标为实验性

如果用户要在 seam 落地前就把它做进本插件，可以实现，但只能是**尽力而为的可见性过滤**：

1. **受管根。** 受管 skill 放在插件自己拥有、且不在任何默认 skill 根之下的目录
   （`$DSH_HOME/capability-catalog/skills/`），这样没有任何宿主 provider 会发现它们。只有
   如此，插件自己的决定对这些名字才是有权威的。
2. **Provider。** `ctx.inject(['skills'], c => c.skills.registerProvider(…))`，沿用本包既有
   的 deferred-inject 模式。host 侧注册会落进**全局层**，而每个 preset 的读取都会合并全局层
   ——包括那些把 `tool-skill` 挂在自己层里的 preset。
3. **按查看 preset 过滤**，写在 `list(options)` 与 `get(candidate, options)` 里。活读取时
   `scope` 就是查看 agent，所以 preset 的还原方式是遍历 `scopeChainOf(scope)` 找那个带字符串
   `agentPreset` 属性的 key（roster 铸的 standing key 就是 `{ agentPreset: preset.id }`，并把
   每个活 agent 的 key 直接绑在它下面）。
4. **语义。** preset 列表缺省/为空 = 所有 preset（今天的行为）；非空 = 只有当解析出的 preset id
   是其成员时才投递。不带 `scope` 的读取保持今天的行为。
5. **存储：skill 自己的 frontmatter**，`metadata.presetScope: [<id>, …]`，走插件本来就拥有的
   那条路径读写（`src/import.ts` 本来就在改写 `disable-model-invocation`，而
   `metadata.credentials` 已经是插件自己的约定）。一份存储，不是两份：settings 命名空间里
   不放它。
6. **watcher 是必须项，不是可选项。** provider 返回数组会被规范化成 `complete: true` 并被
   注册表缓存，而 `tool-skill` 对 incomplete 快照什么都不发布——所以"每次查询重读"不是可选的
   设计。provider 必须监听自己的根，并在外部编辑之后、以及它自己每次写入之后调用
   `control.invalidate()`。
7. **插件自己的读取随之一致。** `snapshotFor(presetId)` 本来就在该 preset 的 standing scope
   上读，`list_capabilities` 在调用者 agent scope 里跑，所以插件列表、模型目录、工具、`/` 菜单
   与能力指纹都来自同一份实现。
8. **迁移与释放**需要真正的协议（见下），因为这条路线会把文件搬出用户当初安装它们的根。

### Scope of enforcement

这是**本 Harness 实例的发现与投递策略**。它不是访问控制边界，也不隔离秘密：

- **不是授权。** `type ScopeKey = object`，没有 brand，而 `bindScopeParent` 是公开 API。任何
  同进程插件或调用方都能把 `{ agentPreset: 'dsh-writing' }` 当作查询 scope 传进去，或把自己
  的 key 绑在同样伪造的 parent 下面，从而看起来像成员。可信过滤需要 roster 给出的已认证身份，
  而那正是 Track 1 的职责。
- **不跨 runtime。** 进程内 agent 与加入父组合的子 agent 在覆盖范围内；原生 `codex` /
  `claude-code` 与 ACP 后端会在同一工作目录里另起自己的 runtime、会话与 skill 发现，根本不查
  这个注册表。一旦 skill 住进私有根，它们通常就完全看不到了——这是需要写明的行为变化，而不是
  隔离保证。
- **只对受管名字有效。** 任何默认根里的残留副本——用户根、两个 project 根或某个 custom 根
  ——都会由宿主 provider 投递进该 preset 的层，而插件在非成员 preset 上"不投递"无法抵消它
  （没有东西可仲裁时就不发生仲裁）。因此重复检测必须扫 project 与 custom 根，而不只是
  `$DSH_HOME/skills`。
- **降级是 fail-open 且无法可靠探测。** provider 契约是 `{ cwd, signal }`，注册表自己的注释也
  说 provider 只应读这份契约；从被借出的对象里读 `scope` 是对当前行为的未声明依赖。若宿主不再
  透传，每个受管 skill 都会在处处可见。从 provider 内部看，一次合法的全局无 scope 读取与一个
  "不再透传 scope 的宿主"完全一样，所以 UI 既不能声称已生效，也不能诚实报告其缺失：它必须把该
  功能标成尽力而为、在 `dsh.compat` 里钉住已验证的宿主范围，而 seam 才是删掉这处转型的办法。

### Caching

注册表的收集缓存键本来就包含 scope 链，所以按 scope 过滤的 provider 在缓存上是正确的。在
provider 内部，只缓存与 scope 无关的文件解析/stat 结果，或者把被过滤结果的缓存键做成
"scope 身份 + 文件 revision"——只用 cwd/name 作键会把一个 preset 的过滤视图喂给另一个。

### Migration and recovery

`DELETABLE_SOURCES` 说的是目录插件可以删哪些来源，它并不能让一个目录变得可以安全移动。把目录
移进受管根至少需要：解析并校验源；目标非空则拒绝；复制到目标根内的临时兄弟目录；完整校验整个
bundle（`SKILL.md` 加资源）；用一次原子 rename 提交；之后才移除源；任一步失败都必须留下至少
一份完整副本。当多个根提供同一个名字时，由用户选定具体安装，而不是插件猜。

由于被限定的 skill 是由本插件投递的，禁用、弄坏或卸载它会让该 skill 从所有 preset 消失——尽管
文件还在。"释放"按钮也只有插件在跑时才够得着。因此受管根要带一份 manifest，记录每个 skill 的
来源与恢复目标；插件要给出**不依赖插件运行**的手工恢复路径；并且卸载时绝不删除受管文件。

## Alternatives considered

**把文件留在 `$DSH_HOME/skills`，只加配置。** 不可能：消费者无法从注册表里减项，而
`dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill` 里都不存在 deny 钩子。结果只会是一个
"对模型所见撒谎"的设置页。

**改用编辑 preset 组合来投递范围（Track 2）。** 有文档、可靠，所以它是即时需求的推荐：`cordis`
preset 本来就是这样带着自己那两个 skill 的。它作为通用能力落选，是因为 shipped preset 只读
——在其中的可见性永远无法授予——并且"逐 skill 的任意子集 × 很多 preset"会变成目录组合爆炸。

**改在消费者侧过滤（`dsh-tool-skill`、`dsh-api-session-controller`）。** 它们手里都有所需
身份（agent，或 `agentPreset` projection），也不需要 scope 管道；但这把同一条策略复制进两个
宿主包，让 `ctx.skills` 对将来每个消费者仍未过滤，而且仍然是宿主改动。既然都要改宿主，
Track 1 的 seam 是更好的落点。

**把范围存进 settings 命名空间而不是 frontmatter。** 它更适合"部署本地策略"——preset id 是
部署词汇，从别处导入的 skill 并不携带——但它制造了第二份映射，必须与 rename/import/delete 保持
一致，而且无法与 skill 一起被评审。frontmatter 在"一份存储"上胜出；若策略必须按部署而非按
skill 定义，它仍是退路。

**先落 Track 3，等 seam 来了再删掉那处转型。** 这就是上面的分期；它只有在具备尽力而为标注、
强制 watcher、迁移协议与钉住的已验证宿主范围时才可接受。

## Acceptance criteria

1. 成员资格必须逐预设、逐面断言，写四个独立测试：目录消息及其 digest、`skill` 工具执行、
   `/name` 手势、`skills/list` Remote DTO——受管 skill 在成员 preset 里存在、在非成员 preset
   里缺席。
2. 在非成员 preset 里执行 `list_capabilities` 省略该 skill；在成员 preset 里包含它。
3. `presetScope` 缺省或为空时处处保持今天的行为，包括装进默认根的 skill。
4. 查询不带 `scope` 时 provider 投递全部受管 skill，且没有任何面声称它无法验证的效力。
5. 在"两个 scope 只差这个受管 skill"的受控 fixture 下，该 skill 的有无会改变能力面与
   `hashOf`；`sha === hashOf(snapshot)` 成立；比较按 skill 行做，不断言整个 snapshot 的
   一般性 if-and-only-if。
6. 迁移：源不存在、目标已存在、以及原子 rename 前后各注入一次失败，每种情况都恰好留下一份完整
   副本；project 或 custom 根里的同名会被检测并上报。
7. 释放：插件 provider 被 dispose 之后，宿主 provider 仍能从全局根列出并加载被释放的 skill。
8. 受管根里由外部编辑的文件只产生一次目录 revision；插件自己执行的写入同步触发失效。
9. 本包在 `ctx.skills` 缺席时仍能安装、启动并降级成空目录——由独立的 loader composition 测试
   验证，而不是只靠 `pnpm gate`。

## Risks

**未声明的 `scope` 读取是中心风险，而且它漏。** 契约说 provider 只读 `{ cwd, signal }`；读
`scope` 违反它，并且失败形态不是"功能关闭"，而是"功能关闭**且** skill 处处可见"——与一次合法
的全局读取无法区分。尽力而为的标注加上钉住的宿主范围是遏制手段；Track 1 才是修法。

**靠结构认身份可被伪造。** 一个形如 `{ agentPreset: … }` 的 key 就是普通数据。任何同进程调用方
都能声称成员资格。这个过滤绝不能被描述成授权，也不能用来门控秘密。

**文件换了家，归属就变弱。** 这些 skill 不再是普通的文件系统 skill：插件一坏，它们就从所有
preset 里消失，被委派的原生 agent 也会失去它们。manifest 加一条不依赖插件的恢复路径是缓解；
seam 通过让文件留在原地直接消除这个问题。

**一份残留副本会静默废掉范围限定。** 跨用户根、project 根与 custom 根的重复检测是承重的，界面
必须给出警告，而不是假定迁移已经完成。

**watcher 缺口会相对今天倒退。** 宿主 provider 的 watcher 才是让 `$DSH_HOME/skills` 保持新鲜
的东西；受管根在插件自己建好之前没有它，所以"忘了建"就是一次静默的陈旧化回归。

**独立安装门。** 本包必须仍能单独启动，并在 `ctx.skills` 缺席时降级。如果 scope 链遍历 import
`@deepseek-ai/dsh-scope`，它就成了一个已声明的（可选）peer 依赖，`dsh.compat` 说明也要跟着变；
结构化遍历能避免这处依赖但更脆弱——无论选哪个，`pnpm check:plugins` 都必须保持绿。

**会话历史影响。** 目录消息是持久且按 digest 比对的。稳定的 scope 不会多发东西；空白会话切换
preset 时通常还什么都没发；一个被 fork 出来的、种子目录与新组合不一致的会话会发一次替换，之后
安静。测试应钉住"一次替换"的行为，而不是假设。

**客户端接线不是免费的。** 详情弹窗的多选在浏览器里读不到 `ctx.get('agentPresets')`：它需要
一个 Remote DTO，带自己的加载与错误状态，而且 roster 可能不可用。
