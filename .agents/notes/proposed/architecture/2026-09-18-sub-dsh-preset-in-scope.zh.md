# Agent Note: sub-dsh 的 preset 随 scope 目录走

Status: proposed

[English](2026-09-18-sub-dsh-preset-in-scope.md) | 中文

## Problem

条件里的 `preset` 在 T32 成为可核对的因子、在 T32b 拿到测量，而 pilot D——那场「两个受试对象只差一个因子，而这个因子就是能力面」的 run——至今跑不起来。T33c 停在就绪闸上，一个 token 都没花，原因是两条要求正面顶住。

**测量要求 preset 待在实例根。** `instanceCapabilityProbe` 经评测实例自己的 catalog 测量，而 catalog 是通过**实例的** roster roots 去解析 preset id 的。scope 若持有自己的 `<scope>/.agent-presets/<id>`，跑的是一份、哈希描述的是另一份，而且静默——所以 `scopeDefersToInstancePresets` 只要看见 scope 有自己的副本就拒绝测量。preset 于是只能待在 `<dshHome>/.agent-presets/<id>`。

**单元里只有 scope。** 一个格子的单元恰好 bind 挂一个目录，即这条条件的 scoped home（`dsh@d-lean -> /creds/dsh`），而 plan 的 `unit` 段是 `additionalProperties: false`——没有任何字段能把别的东西挂进去。于是 roster 的 `roots` 指的宿主 preset 根，在单元里就是一条不存在的路径：

```
dsh: agent-presets: preset "eval-lean" not found (available: standard, ptc, minimal, cordis)
```

结果是：宿主轮解析得到 preset 却核不了环境指纹，容器轮核得了指纹却解析不到 preset，pilot D 的判据——*两个能力哈希不同**而**环境是同一个*——两条路各缺一半。

根因比看上去小，而且不在 roster。`@deepseek-ai/dsh-agent-presets` 本来就把 `<$DSH_HOME>/.agent-presets` 作为缺省用户根，而 sub-dsh 两侧都以 scoped home 作 `DSH_HOME`——宿主上是 `<scope>/.agent-presets`，单元里是 `/creds/dsh/.agent-presets`，**同一个目录，因为单元挂的就是 scope**。`provision.ts` 的注释原话就是这个意思：往那儿放一个 preset 目录，就是 scope 自己的 preset。把 `roots` 逼向实例根的是 T32b 的守卫，而守卫防的是一份没人核对过的副本。

T33c 之后有两件新情况。preset 已正本化（`6b8a919a`）：部署上的名册由 git 正本同步而来，实例根是仓库所拥有之物的**部署副本**。而 pilot D 的两个 preset（题库 `env/presets/` 下的 `eval-lean`、`eval-full`）各自把 `customSkillDirs` 钉死在实例根下的绝对路径上——preset 一搬家这条就不成立，所以这件事必须先答。

## Proposal

**让 scope 自带一份 preset，把这份副本当作受试对象，并把「scope 不得持有副本」换成「scope 的副本必须与 catalog 测的那份逐字节相同」。**

四个部件，没有一个动到 eval 的挂载：

1. **快照。** `<scope>/.agent-presets/<id>` 是实例根 `<dshHome>/.agent-presets/<id>` 的逐字节副本——真文件，绝不用软链（`hashHome` 把软链算作 denied，而指向宿主路径的软链恰恰是过不了 bind mount 的东西）。
2. **roster 层不再写 `roots`。** 用 roster 自己的缺省用户根，宿主与单元解析的都是同一个 `<$DSH_HOME>/.agent-presets/<id>`——一套解析规则而不是两套，这就是全部要点。
3. **守卫改的是语义，不是强度。** `scopeDefersToInstancePresets` 变成 `scopeSnapshotAgrees`：scope 不持副本时照今天接受（T32b 的宿主装置继续可用，附一条「这样在单元里解析不到」的警告）；持有副本时必须与实例根那份逐字节相同，否则拒绝测量。被抓住的仍然是漂移——只是改为靠比对抓，而不是靠禁止。
4. **eval 的单元词汇一字不动。** 一个挂载、同样的环境指纹、`unit` 段不加字段、plan 契约不变。

### 为什么量实例那份仍然能回答 scope 那份

catalog 没有「给这个目录里的 preset 打指纹」这个动词，本提案也不加。不需要，因为**规范化的能力面里没有任何文件系统路径**。`canonicalCapabilities` 把一条技能投影成 `{name, source, body-sha}`、一个工具投影成 `{name, channel, parameters}`、MCP server 投影成它的工具名、channel 投影成名字——而 `source` 是根的**通道标签**（`customSkillDirs` 那种根是 `custom`），不是根在哪儿。两个逐字节相同的 preset 目录放在两个地方，哈希必然相同。

这不只是从代码推出来的；T32 自己的真机轮就测到过，只是当时为的是另一件事：第三个 scope 把 `eval-lean` 的内容换个 id 叫 `renamed-lean`，哈希与放 `eval-lean` 的那个 scope 逐字节相同。preset 的**名字**不是能力，它的**位置**也不是。

所以逐字节相等就是把测量从「catalog 读得到的那份」转移到「sub-dsh 实际跑的那份」的凭据，而证明这个相等正是守卫的新职责。这是在 T32b 那个折衷（量的是实例的组合，不是 sub-dsh 的）之上再叠一层折衷，和那一层一样，写进模块文档与 README，而不是留给人去发现。

### 搬家规则：`customSkillDirs` 不得是绝对路径

整条路线系于此问，而答案是 loader 本来就支持「相对 preset 目录」的技能根，用的正是官方 `cordis` preset 的写法。

`skill-filesystem` 对每个 `customSkillDirs` 条目做 `resolve()`，所以绝对路径照抄、裸相对路径按 `process.cwd()` 解析——两者都不可搬家。但组合行的 config 可以带 `!!js` 表达式，loader 以 `with (ctx) { eval(expr) }` 求值（`vendor/loader/src/config/utils.ts`），而 `Include` 把该上下文的 `baseUrl` 设为组合文件自己的目录（`vendor/include/src/index.ts`；agent-presets 的 `mount.ts` 与 `specifier.ts` 都建立在这条之上）。官方 preset 的写法是：

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
```

注释原话是*「`baseUrl` 是 preset 自己的目录，所以这个根跟着 preset 装到哪儿就解析到哪儿」*。一个字面串，在实例根对、在 scope 里对、在单元里 `/creds/dsh/.agent-presets/<id>/skills` 也对。**不需要宿主线做任何事，备选路线在这一条上也就不必要了。**

由此换来的规则值得写成规则：**用作评测因子的 preset，其组合里不得出现绝对文件系统路径。** 绝对路径恰恰是唯一不可能在两处同时为真的东西，带着它的 preset 是一个「被复制就会改变含义」的受试对象。两端都拒：`local-agent-dsh` 拒绝快照这样的组合并点名那个写法，eval 的守卫拒绝测量这样的快照——因为复制与测量正是错误答案会被铸出来的两个地方。pilot D 的两个 preset 今天各有一行这样的路径，必须改写；那是题库仓库的改动，列在验收判据里。

### 谁写什么——以及决定这件事的那颗重启地雷

`provisionDshSubProfile` 是整份重写 `cordis.patch.yml` 的：headless patch + `presetRosterLayer(config.preset)` + `permissionBoundaryLayer(config.permissions)`；而 local-agent 的注册表**每个宿主进程里每个 (harness, scope) 只跑一次** scope 的 `provision` 钩子——在第一次有人点名这个 scope 的时候。于是手写的 roster 层会被下一次重启静默抹掉，再 provision 就报「the scoped home rosters no readable preset」。pilot D 的装置是手写的，能活到现在只是因为中间没人重新 materialize 过那两个 scope。**任何把 roster 留给手写的设计，都是会把它弄丢的设计。**

所以 scope 组合哪个 preset 必须**从 scope 自己**读得出来，就像它的 roster 层与权限边界已经那样——scope 目录里的一个文件，于是被 bind 进单元的 scope 自带它的组合：

- `<scope>/sub-profile.json`（名字待定），内容 `{"preset": "<id>"}`。`provisionDshSubProfile` 按*显式参数 → scope 文件 → 插件 config* 解析 preset，并把显式参数持久化进该文件。抗重启、幂等、人读得懂。
- `LocalAgentHarness.provision` 放宽成 `(homeDir, options?)`，注册表新增 `provisionScope(name, scope, options?)`——按 per-scope 选项重跑某个 scope 的 provisioning。另外三家忽略该参数，逐字节不变。
- 条件声明了 preset 时，`conditions provision` 在读回 roster 之前先调 `provisionScope(harness, scope, {preset})`。门面没有这个动词就退回今天的行为——有什么读什么——于是 T32b 的手造装置照样量得到。

这也是 pilot D 缺陷 1 的正经修法。`local-agent-dsh` 的 config 是实例级的，所以「两个 scope 各 roster 一个 preset」表达不出来、只能手写；有了 per-scope 文件与这个动词，做主的是条件文档——评测的因子本来就该待在那儿。

**快照只由 `conditions provision` 刷新**（带显式 preset 参数时从实例根重新同步）。注册表自己的 materialize 只修 roster 层，不碰快照。provision 是铸新 lock 的那一下，因此也正是该接住「正本被改过」的那一下；除此之外任何东西都不得在 run 底下挪动受试对象。

`eval` 不往 scope 里写任何东西，也不会比今天更多地学会那份 patch 的格式。

### lock，以及它唯一不能记的东西

`provisioned.capabilities` 增两个键（schema **v1-rev12**，在 T31 那个可加块内可加）：

- `snapshot: {sha}`——对整棵 `<scope>/.agent-presets/<id>` 的 sha256，**每一个**文件都算，`SKILL.md` 也算，流的形状照 `hashHome`（`<relPath>\0<content>\0`，按 relPath 排序）。`home.sha` 有意只哈希配置后缀的文件，所以技能正文的改动不动它记的任何东西；看得见这件事的就是这一条，而且是离线看得见。
- `source: "scope-snapshot" | "instance-root"`——测量是以哪种方式被转移过来的。

**不记实例根的路径。** 文案要的是它；但 lock 是要提交进题库仓库的被评审数据，而 `unit.ts` 立的规矩是这类文件里不出现宿主路径。内容哈希本来也是更好的出处：路径说的是有人去哪儿看过，哈希说的是两份副本当时相同。等哪天部署报得出 pack 版本，可以再加——今天没有任何东西报得出。

有一个后果是白得的：快照里的 `agent.cordis.yml` 与 `preset.yml` 是 scoped home 里的 `.yml` 文件，所以 **`home.sha` 现在也随 preset 而动**。pilot D 那两条条件本来就被 `home.sha` 分开，现在被它以更锋利的理由分开；而改一个 preset 会重新哈希条件，这一条该写进协议文档。

### 就绪检查，以及 T32b 关不掉的那个缺口

- 就绪检查重算 scope 快照的哈希，不一致即拒——「scope 的 preset 快照在 provision 之后变了，请重 provision」。离线、不碰 catalog、不发委派、不花 token。
- 现有的 catalog 重量原样保留。它现在回答的是稍有不同的问题——实例根是否仍与 lock 记的相符，也就是某人的编辑是否没能走到 scope——而两种读法下它的指令都是「重 provision」，所以只需把解释写宽一点。
- `validate` 也能跑这条快照检查，于是把 T32b 记下却关不掉的那个缺口关上：*「validate 仍然把过期的 lock 报成 ready……它是离线的，量不了」*。它量不了能力面，但它能哈希一个目录。建议一并做掉，因为只有几行，而且能让 `conditions list` 不再与 run 相互矛盾。

### 什么没变

不声明 `preset` 的条件碰不到这里的任何一样：`provisionScope` 只为声明了 preset 的条件调用，守卫只为这种条件查询，lock 的新键只在有快照时出现。`presetRosterLayer(undefined)` 照旧返回 `''`。`roots` 字段留在 config 上给需要它的部署。非 preset 条件的宿主轮 provisioning 逐字节不变，并有测试钉住。

## Alternatives considered

**把实例的 preset 根挂进单元（文案里的备选）。** `unit` 段是 `additionalProperties: false`，所以这是一次 plan 契约的改动；plan 是被评审数据、不得携带宿主路径，于是路径必须来自一个新的门面动词、由 eval 注入；`unit.ts` 的「恰好一个挂载」契约变成两个，环境指纹还得把第二条挂载算对（它是各条件共享的，所以归共享分量而不是 per-condition 排除项——又多一处必须不出错的地方要做对）。而且 roster 仍然点名一条宿主路径，于是正本一搬家、或部署的 `DSH_HOME` 一不同，这套就死。它唯一的好处是绝对 `customSkillDirs` 继续能用——而搬家规则把这条好处抹掉了，用的还是官方 `cordis` preset 已经证明可用的写法。否决；若 `!!js` 求值在真机上不成立，保留它作为回退。

**给 catalog 加一个「按目录给 preset 打指纹」的动词。** 它能直接量 scope 那份而不靠相等推导，也是这个问题的诚实形状。代价是 `capability-catalog` 的服务面、它的 `@Remote` 面、eval 的 face，再加 roster 为临时根走一条 mount 路径——换来的性质逐字节相等已经给了，而这次测量本身就是一个已声明的折衷、且预定要被 in-scope 测量取代。现在否决；并点名：哪天有因子需要一个**只存在于 scope 里**的 preset，该建的就是它。

**教 roster 的 `roots` 写一条两侧都对的路径。** roster 只展开开头的 `~`，别的不展开；而两侧都对的路径恰恰是 `$DSH_HOME/.agent-presets`，也就是缺省用户根。这个备选自己塌回本提案。

**把 scope 的副本做成指向实例根的软链。** `hashHome` 跳过软链并计入 denied，受试对象就不再被哈希；而指向宿主路径的软链在单元里解析到虚无。否决。

**让 eval 自己写 roster 层。** 按 T32b 为「读」已经记过的同一条理由否决：patch 的格式归 `local-agent-dsh`，而它在 materialize 与每一次宿主轮都会修这个文件。给一个由别的包重新生成的文件加第二个写者就是漂移发生器，而 eval 会因此拥有一份它不可 import 的格式。

**把 per-scope 的 preset 写进插件的实例级 config（`presetByScope`）。** 否决：因子会待在实例的设置里而不是数据集里，而且它不会随 bind mount 走。scope 目录两条都满足——roster 与权限边界已经住在那儿正是为此。

**保留 T32b 的守卫，接受「带 preset 的条件只能跑宿主轮」。** 这就是今天，也正是让 pilot D 的判据在两条路上都证不出来的原因。任务本身否决了它。

## Acceptance criteria

- `packages/eval`、`packages/local-agent-dsh`、`packages/local-agent` 三套测试绿；`pnpm gate` 绿。
- 不声明 preset 的条件，provision 逐字节不变——由一条比对生成的 `cordis.patch.yml` 与 lock 文档的测试钉住。
- 组合里带绝对路径的 preset，在快照与测量两处都被拒，消息各自带上 `baseUrl` 那个写法。
- 题库侧（`i4-pilot-d`）：`eval-lean` 与 `eval-full` 改写成 `baseUrl` 表达式。预期效果先说在前面，好让 run 去确认：**两个 `caps` 哈希不动**（面里没有路径，技能也没变），而**两个 `home.sha` 都动**（快照的 `.yml` 现在在 scoped home 里），于是两条条件的哈希各动一次、由写回记录。
- 3171 上的容器轮：两条 sub-dsh 条件都 `ready`；就绪检查再量的结果与 lock 一致；P0 一轮四条不变量 ✅、比较节打开——pilot D 的收口由本任务自己跑，不与 T55 的探针同时。

## Risks

- **这两个 preset 从没跑过 `!!js` 表达式。** 官方 `cordis` preset 用的就是它、loader 也确实以 `with (ctx)` 求值，但真机上第一件要看的就是：挂了快照 preset 的 sub-dsh 找不找得到自己的技能。找不到，搬家规则就变成宿主线的活，答案就是回退路线。
- **单元里的权限位与属主。** scope 是 0700、单元以 user 1000 跑；快照继承 scope 的属主，而现有的凭据目录检查已经容忍 Docker Desktop 的属主重映射。读不到的快照与不存在的快照报的是同一句「preset not found」，验收轮必须把两者分开。
- **子 profile 有两个写者。** `local-agent-dsh` 在 materialize 与每一次宿主轮修 patch，provision 刷新快照。若某个 scope 的文件与它的 lock 各说各话，一次宿主轮会把它重新 roster。per-scope 文件让两者一致；这个先后顺序值得单独一条测试。
- **三个包，不是两个。** 文案把范围定在 `eval` 与 `local-agent-dsh`；per-scope 的 provisioning 动词多带一个 `local-agent`。有一个缩减变体——只要 per-scope 文件、手写、不加门面动词——把改动压在两个包内，代价是每个 scope 一份手写 JSON、需要重启实例（或跑一次宿主轮）才生效、以及 pilot D 的缺陷 1 继续挂着。由协调者定。
- **仍然推迟的东西。** 量到的面仍是实例对该 preset 的读数，而非 sub-dsh 自身组合的面。`capability-probe.ts` 依旧是 in-scope 测量将来替换实例读数的那个地方，而在那之前写下的每一份 lock 对它都读作过期——就绪闸已经把这件事变成「重 provision」而不是一次静默的错配。
