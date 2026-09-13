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

拓扑并不统一：

- `packages/bundle/base/cordis.patch.yml` 注册了一个宿主级 `skill-filesystem` 行；宿主行
  落进 skill 注册表的**全局层**，而每个 preset 的读取都会合并全局层。
- Web 部署**禁用**了那一行以及宿主 `tool-skill` 行
  （`packages/bundle/web-app/cordis.patch.yml`："the base host `skill-filesystem` row is
  disabled here (presets own local discovery)"），而 `dsh-skill` 注册表本身仍留在宿主面。
- 于是在 Web 里 `standard`、`cordis`、`ptc` 各自把 `skill-filesystem` 挂进**自己那一层**，
  而这些行扫的是同一个默认用户根。因此这两个 skill 在任何挂了这类行的 preset 里都出现——靠的是
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

### 为什么必须在下游解决

本仓库跟踪宿主，不做 fork。宿主改动走 upstream-change pipeline 是既定路线，但
`docs/upstream-proposals/` 里已有的先例说明：上游需求可能长期得不到支持——tool-origin 提案
最终是靠"用宿主已公开的 API 挂一个社区自持约定"才落地的。`dsh-skill` 里的 seam 会让本功能更
简单（见 Alternatives considered），但设计不能等它，所以下面的机制完全由宿主已经导出的 API
搭成。

## Proposal

把受管 skill 放在**插件自己拥有的根**里，并把 provider **注册进每个目标 preset 自己的 scope
层**，逐 skill 的 preset 列表写在 skill 的 frontmatter 里。

### 层机制凭什么能做到这件事

skill 注册表按"注册来自哪个 scope"分层（`packages/skill/skill/src/index.ts`："a scoped
context (an agent preset's standing mount) registers for that scope alone, an unscoped
context registers globally"）。一次读取会把全局层与查看 scope 的链合并，最远的祖先在前、
最近的 scope 最后，同名时近层胜出（`packages/core/scope/src/store.ts` 的
`ScopedLayers.merge` / `chainLayers`）。

```
一次 skill 注册表读取 =
    全局层
  + 查看 agent 的 scope 链上每一层的层
  └─ 合并；同一条链内近层压过同名

dsh-writing 会话： 链 = [agent 的 key，dsh-writing 的 standing key]
                   → 插件的 provider 住在那一格里 → 看得见
standard 会话：    链 = [agent 的 key，standard 的 standing key]
                   → 那一格里没有插件的 provider → 看不见
```

所以"可见性"不是读取时的一次过滤决定，而是**provider 被注册进了哪一格**。注册进目标 preset
的那一格之后，就再也不需要回答"现在是谁在读？"——而这个问题 provider 契约本来就答不了（见
Alternatives considered 的 "Request-time filtering"）。

### 投递作用域

对每个要投递的 preset：

```ts
const key = await ctx.agentPresets.standingKeyFor(presetId)   // 文档化的 roster API
const delivery = createScope(ctx, key)                        // dsh-scope：以该 key 建 scope
delivery.ctx.skills.registerProvider(control => ({
  name: 'capability-catalog-scoped',                          // 同名只在同一层冲突，不是全局唯一
  list: (options) => managedSkillsFor(presetId, options.cwd), // 绝不读 options.scope
  get: (candidate, options) => loadManaged(candidate, options.cwd),
}))
```

`createScope` 会铸一个打了该 key 标记的 context，且**不校验 key 是否新建**
（`packages/core/scope/src/index.ts`）；`ScopedLayers.effect` 每个 key 对象存一格，且只在
该格为空时才删除它（`packages/core/scope/src/store.ts`）——所以插件与 preset 挂载共享同一格，
插件的 dispose 不会拆掉 preset 自己的注册。provider 名只在同一层内唯一，因此多层可以同名
（`packages/skill/skill/src/index.ts`）。

skill 内容仍由插件提供：受管根是唯一来源，provider 自己解析每个 `SKILL.md`，并给出 `path` 与
`resourceBase`，让详情弹窗、`skill` 工具的资源解析与删除都照常工作。

与 preset generation 的对账是承重设计，不是细节：

- `standingKeyFor` 会**真的 mount** 被请求的 preset（装配插件，但不启动 agent、不开 turn），
  所以插件不能对它策略里的每个 preset 预先解析；
- 每个 standing mount 有自己的 key 对象，而组合文件一变就会开出**新的 key** 的新 generation，
  已加入的会话留在旧 key 上；
- 因此插件按 `livePresetMounts()`（已导出，带 `presetId` 与 `key`）加上
  `agent-preset/selected(sessionId, agentPreset)` 事件对账：给每个被引用 preset 的当前 key
  注册；旧 key 的注册保留到旧挂载消失；key 没了再 dispose 对应的投递作用域。

于是某个 preset 的首个会话可能滞后一次目录 revision：provider 在插件察觉到挂载后才出现，而目录
消息会在下一个 pre-step 重新发布。这个滞后可以接受，但必须写进界面文案并由测试钉住。

### 配置与投递模式

逐 skill 的列表放在 skill 自己的 frontmatter 里，`metadata.presetScope: [<preset-id>, …]`
——插件本来就为已安装 skill 改写 frontmatter，也本来就拥有一个 `metadata.*` 约定
（`metadata.credentials`）。缺省/为空 = 所有 preset（今天的行为）。一份存储，不是两份：
settings 命名空间里不放它。

每个 skill 只有一种投递模式：

- **scoped 注册**（非空 `presetScope` 的默认）——受管根是唯一副本；
- **全局根**（范围为空）——按今天的方式安装，由宿主 provider 投递，插件不参与。

"为用户自有 preset 自动维护组合行"（往 `trust: user` 的 preset 里写一行
`skill-filesystem` + `customSkillDirs`）是以后可选的便利功能，不是兜底：宿主刻意只给 preset
提供 copy/delete，所以这种编辑器必须能保留注释、`!!js` tag、行序与手工编辑，用 CAS 加原子写，
只维护自己那一行，并在行冲突时拒绝"顺手修好"。同一个 skill 有两条投递路径会把这个设计刚刚消除的
重名与卸载语义问题重新造出来。

### 新鲜度

provider 返回数组会被当作一次完整观测并被注册表缓存，而 `dsh-tool-skill` 对 incomplete 快照
什么都不发布。所以"每次查询重读"不可得：受管根需要自己的 watcher、外部变化后
`control.invalidate()`、以及插件自己每次写入后的同步失效。watcher 失败时返回 incomplete 是一
种异常状态，不是正常运作方式。

provider 内部只缓存与 scope 无关的解析/stat 结果，或把被过滤结果的缓存键做成"目标 preset +
文件 revision"——只用 cwd/name 作键会把一个 preset 的视图喂给另一个。

### 插件自己的视图显示什么

`snapshotFor(presetId)` 本来就在该 preset 的 standing scope 上读，`list_capabilities` 在
调用者 agent scope 里跑，所以设置页网格、模型目录、`skill` 工具、`/` 手势、`/` 菜单与能力指纹
都来自同一份投递。卡片还必须按 skill 展示：配置里的 preset、当前真正解析成功的有哪些（把
missing/broken 与 active 区分开），以及重名诊断。浏览器面需要一个 roster 的 Remote DTO——客户端
读不到 `ctx.get('agentPresets')`。

### Scope of enforcement

这是**本 Harness 实例的发现与投递策略**。它不是访问控制边界，也不隔离秘密：

- **不是授权。** `type ScopeKey = object`，没有 brand，`bindScopeParent` 是公开 API，而且
  `standingKeyFor` 会把真 key 交给任何调用方。同进程插件可以注册进另一个 preset 的层，或带着
  它的 scope 读。注册进目标层消除的是**误判身份**，并不能让成员资格不可伪造。
- **不跨 runtime。** 进程内 agent、以及加入父组合的子 agent 在覆盖范围内。原生 `codex` /
  `claude-code` 与 ACP 后端在同一工作目录里另起自己的 runtime、会话与 skill 发现，根本不查这
  个注册表；一旦文件住进私有根，这些 agent 通常就完全看不到它们。这是要写明的行为变化，不是隔离
  保证。
- **只对受管名字有效。** 任何默认根里的残留副本——用户根、两个 project 根、
  `$DSH_AGENTS_HOME/skills` 或某个 custom 根——都会由宿主 provider 投递进该 preset 的层，而
  插件在非成员 preset 上"不投递"无法抵消它。重复检测必须扫每一个可发现的默认根，并且严重重复
  时必须**拒绝启用** scoped 投递，而不是只警告。

### Migration, release, and recovery

`DELETABLE_SOURCES` 说的是目录插件可以删哪些来源，它并不能让一个目录变得可以安全移动。给已安装
的 skill 加范围就要把它移进受管根：解析并校验源；目标非空则拒绝；复制到受管根内的临时兄弟目录；
完整校验整个 bundle（`SKILL.md` 加资源）；用一次原子 rename 提交；之后才移除源；任一步失败都
必须留下至少一份完整副本。当多个根提供同一个名字时，由用户选定具体安装。

被限定的 skill 由本插件投递，所以禁用、弄坏或卸载它会让该 skill 从所有 preset 消失——尽管文件
还在。而"释放"操作也只有插件在跑时才够得着。因此受管根带一份 `RECOVERY.md` 与 manifest（来源、
建议恢复目标、bundle 哈希、策略），但它是**索引**而不是恢复机制本身：每个 skill 目录自包含，
恢复就是一条文档化的 `cp` 回某个默认根、不需要插件，manifest 也可以靠扫描 `SKILL.md` 重建，
并且卸载绝不删除受管文件。

### Containment and verification

- `package.json` 声明新的可选 peer（`@deepseek-ai/dsh-scope`，以及为 roster 的
  `@deepseek-ai/dsh-agent-presets`），并在 `dsh.compat.notes` 里写明：已验证的宿主范围、
  这是发现策略、外部 agent 不覆盖、以及 canary 的含义。
- 两个 README 的 `Compatibility` 段承载同样的表述。
- `src/invariant.ts` 现在断言"catalog is read-only"，实现后即为事实错误。它改为断言：受管根
  不在任何已知默认根内；投递注册只对活/当前 preset key 存在；一个 skill 名只有一种投递模式；
  永不写 `trust: system` preset；manifest 与磁盘上的 skill 目录一致。
- 一个 host-contract canary 钉住本设计借用、但并非宣传扩展点的两处行为：
  `createScope(ctx, existingKey)` 产出的 context 其注册会落进该 key 的层，以及 provider 注册
  返回的数组会被当作 complete 缓存。任何一处变了，canary 立刻红，而不是功能静默改变含义。

## Alternatives considered

**把文件留在 `$DSH_HOME/skills`，只加配置。** 不可能：消费者无法从注册表里减项，而
`dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill` 里都不存在 deny 钩子。结果只会是一个
"对模型所见撒谎"的设置页。

**让每个用户自有 preset 靠 `customSkillDirs` 拥有这些 skill（宿主自己的机制，shipped
`cordis` preset 就在用）。** 诚实、有文档、零插件零宿主改动——对作者自己拥有的 preset 它就是
正确答案。它作为通用能力落选，是因为 shipped preset 只读（在其中的可见性永远无法授予），并且
"逐 skill 的任意子集 × 很多 preset"会退化成目录组合爆炸。当目标 preset 全是用户自建时，它仍是
推荐的替代做法。

**读取时过滤：全局 provider 去读被借出的 view scope。** 注册表确实把同一个 options 对象
（含 `scope`）传给 `provider.list`，但声明契约只有 `{ cwd, signal }`，且注册表注释明确说
provider 只应读这份契约。失败方向也是错的那一侧：不再透传 scope 的宿主会让每个受管 skill 处处
可见，而从 provider 内部看，一次合法的无 scope 读取与这次宿主变更无法区分——插件连诚实报告降级
都做不到。只作为 canary 门控下的最后手段保留，绝不作默认。

**改在消费者侧过滤（`dsh-tool-skill`、`dsh-api-session-controller`）。** 它们手里都有所需
身份、也不需要 scope 管道；但这把同一条策略复制进两个宿主包，让 `ctx.skills` 对将来每个消费者
仍未过滤，而且那是本仓库做不了的宿主改动。

**把每个 skill 作为 runtime skill 注册（`ctx.skills.register`）进 preset 层。** 分层相同，但
runtime 条目 rank 250——高于用户 filesystem provider 的 400——所以默认根里的残留副本会被压过
而不是被检出；还要预读全文，且每次文件变化都要 dispose 再重注册。provider 让发现保持诚实。

**把范围存进 settings 命名空间而不是 frontmatter。** 它更适合"部署本地策略"——preset id 是
部署词汇，导入的 skill 并不携带——但它制造了第二份映射，必须与 rename/import/delete 保持一致，
也无法与 skill 一起被评审。frontmatter 在"一份存储"上胜出；若策略必须按部署定义，它仍是退路。

**等上游 seam。** 一处已声明的 per-provider view context（或在注册表层按已声明元数据过滤）能删掉
canary 依赖，并让每个消费者无需本插件投递就自动一致。值得记录成请求，但按上面的先例，它不能
卡住这个能力。

## Acceptance criteria

1. 成员资格必须逐预设、逐面断言，写四个独立测试——目录消息及其 digest、`skill` 工具执行、
   `/name` 手势、`skills/list` Remote DTO——受管 skill 在成员 preset 里存在、在非成员 preset
   里缺席。
2. 一个列了多个 preset 的 skill 在每一个里都被投递、别处都不投递；空列表与今天完全一致，
   包括装在默认根里的 skill。
3. provider 的 `list`/`get` 绝不读 view scope：一个测试注册进两个 preset 层，断言各自只返回
   自己的分配，而借出的 options 里根本不含 scope 信息。
4. generation 对账：组合文件变化后，新会话在新 key 下仍看得到这些 skill，而已经加入旧 generation
   的会话也仍看得到；旧投递作用域只在其挂载消失之后才被 dispose。
5. 首会话滞后有界：投递 provider 在该会话第一个 pre-step 之后才出现的 preset，只会重新发布一次
   目录，之后日志不再增长。
6. 受管根里的外部编辑恰好产生一次目录 revision；插件自己执行的写入同步失效；watcher 失败时
   表现为 incomplete 观测。
7. 迁移：源不存在、目标已存在、以及原子 rename 前后各注入一次失败，每种情况都恰好留下一份完整
   副本；project、agents-home 或 custom 根里的同名会被检测并阻止启用 scoped 投递。
8. 恢复：插件被 dispose 之后，按文档把某个受管 skill 目录 `cp` 回 `$DSH_HOME/skills`，宿主
   provider 就能列出并加载它；卸载不碰受管根；manifest 可由目录扫描重建。
9. invariant 与遏制：受管根落在任何默认根内都会被拒绝；同一个 skill 不能同时有两种投递模式；
   永不写 `trust: system` preset；`dsh.compat` 与 README 的 Compatibility 写明已验证宿主范围、
   发现策略这一定性与外部 agent 排除。
10. 独立 loader 覆盖：在 `ctx.skills`、`ctx.agentPresets` 或 `dsh-scope` 缺席时，本包仍能安装、
    启动并降级成空目录——由 composition 测试断言，而不是只靠 `pnpm gate`。

## Risks

**不是授权边界，也绝不能被描述成授权。** key 就是普通对象，真 key 还能由公开 API 交出去。这条
策略门控的是"行为规范实例里的可见性"，仅此而已。

**本设计借用了两处未宣传的行为。** 把 context 的 scope 设到 roster 已经铸好的 key 上，以及
provider 注册返回的数组会被当作 complete 缓存，都是当前源码事实而不是声明的扩展点。canary 是
遏制手段：它们针对已安装宿主被断言，于是宿主升级会让某个测试红，而不是悄悄改变功能含义；钉住
`dsh.compat` 把爆炸半径限制在受支持范围内。

**文件换了家，归属就变弱。** 这些 skill 不再是普通的文件系统 skill：插件一坏，它们就从所有
preset 里消失，被委派的原生 agent 也会失去它们。自包含的受管根加一条不依赖插件的 `cp` 恢复路径
是缓解；而从默认根投递根本无法被限定范围，所以不存在"两者都保住"的替代。

**一份残留副本会静默废掉范围限定。** 跨用户根、project 根、agents-home 与 custom 根的重复检测
是承重的，规则是拒绝启用而不是警告。

**generation 轮换很容易做错。** key 是对象身份，会随组合文件改变，而旧会话保留旧 key。只给最新
generation 注册，会让活着的会话丢失这些 skill；过早 dispose 会让它们在会话中途丢失。
`livePresetMounts()` 加选择事件是对账输入，AC 4 把它钉住。

**启动时序仍未解决。** 插件不能在不 mount 它们的前提下预先解析策略里的每个 preset，而创建
会话并不发 `agent-preset/selected`；当前答案是按活挂载对账，并接受 preset 首个会话滞后一次目录
revision。更干净的触发点需要宿主提供 mount 事件，或一个不触发组合的 roster 查询。

**漏掉 watcher 就是一次新鲜度回归。** 宿主 provider 的 watcher 才是让默认根保持新鲜的东西；
受管根在插件自己建好之前没有它。

**独立安装门。** 本包必须仍能单独启动并降级。import `@deepseek-ai/dsh-scope` 与 roster 类型会
让它们成为已声明的可选 peer，并让兼容说明变长；`pnpm check:plugins` 必须保持绿。

**会话历史影响。** 目录消息是持久且按 digest 比对的。稳定的投递不会多发东西；一个种子目录与
自身组合不一致的 fork 会发一次替换、之后安静。测试钉住"一次替换"，而不是假设。

**客户端接线不是免费的。** 详情弹窗的多选需要一个 Remote DTO，带加载与错误状态；roster 可能
不可用，而存下来的 preset id 也可能指向已删除或已损坏的 preset。
