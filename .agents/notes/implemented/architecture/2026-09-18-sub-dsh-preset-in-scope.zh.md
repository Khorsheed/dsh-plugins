# Agent Note: sub-dsh 的 preset 随 scope 目录走

Status: implemented

[English](2026-09-18-sub-dsh-preset-in-scope.md) | 中文

## Problem

条件里的 `preset` 在 T32 成为可核对的因子、在 T32b 拿到测量，而 pilot D——那场「两个受试对象只差一个因子，而这个因子就是能力面」的 run——仍然跑不起来。T33c 停在就绪闸上，一个 token 都没花，因为两条要求正面顶住。

**测量要求 preset 待在部署的 preset 根。** `instanceCapabilityProbe` 经评测实例自己的 catalog 测量，而 catalog 通过**实例的** roster roots 解析 preset id。scope 若持有自己的 `<scope>/.agent-presets/<id>`，跑的是一份、哈希描述的是另一份，而且静默——所以 `scopeDefersToInstancePresets` 只要看见 scope 有自己的副本就拒绝测量。

**单元里只有 scope。** 一个格子的单元恰好 bind 挂一个目录，即这条条件的 scoped home（`dsh@d-lean -> /creds/dsh`），而 plan 的 `unit` 段是 `additionalProperties: false`。于是 roster 的 `roots` 指的宿主 preset 根，在单元里就是一条不存在的路径：

```
dsh: agent-presets: preset "eval-lean" not found (available: standard, ptc, minimal, cordis)
```

结果是：宿主轮解析得到 preset 却核不了环境指纹，容器轮核得了指纹却解析不到 preset，pilot D 的判据——*两个能力哈希不同**而**环境是同一个*——两条路各缺一半。

根因比看上去小，而且不在 roster。`@deepseek-ai/dsh-agent-presets` 本来就把 `<$DSH_HOME>/.agent-presets` 作为缺省用户根，而 sub-dsh 两侧都以 scoped home 作 `DSH_HOME`——宿主上是 `<scope>/.agent-presets`，单元里是 `/creds/dsh/.agent-presets`，**同一个目录，因为单元挂的就是 scope**。把 `roots` 逼向部署 preset 根的是 T32b 的守卫，而守卫防的是一份没人核对过的副本。

T33c 之后有两件新情况。preset 已正本化（`6b8a919a`）：部署上的名册由 git 正本同步而来，实例根是一份**部署副本**。而 pilot D 的两个 preset 把 `customSkillDirs` 钉死在实例根下的绝对路径上——preset 一搬家这条就不成立。

## Decision

**scope 自带一份 preset 副本，这份副本就是受试对象；「scope 不得持有副本」换成「scope 的副本必须与 catalog 测的那份逐字节相同」。**

1. **快照。** `<scope>/.agent-presets/<id>` 是 `<部署 preset 根>/<id>` 的逐字节副本——真文件，绝不用软链（`hashPresetTree` 与 `hashHome` 都拒软链，而指向宿主路径的软链恰恰过不了 bind mount）。
2. **roster 层不再写 `roots`。** 用 roster 自己的缺省用户根，宿主与单元解析的都是同一个 `<$DSH_HOME>/.agent-presets/<id>`——一套解析规则而不是两套。
3. **守卫改的是语义，不是强度。** `scopeDefersToInstancePresets` 改名 `scopeKeepsOwnPreset`。scope 不持副本时照 T32b 的样子测（`source: "instance-root"`），探针另记一句「单元里解析不到」；持有副本时，只有做出这份副本的 provisioning 报告它逐字节相同才测（`source: "scope-snapshot"`）。
4. **eval 的单元词汇一字未动。** 一个挂载、同样的环境指纹、`unit` 段不加字段、plan 契约不变。

### 为什么量部署那份仍然能回答 scope 那份

catalog 没有「给这个目录里的 preset 打指纹」这个动词，本次也不加。不需要，因为**规范化的能力面里没有任何文件系统路径**：`canonicalCapabilities` 把技能投影成 `{name, source, body-sha}`——`source` 是根的**通道标签**（`custom`），不是根在哪儿——工具投影成 `{name, channel, parameters}`，MCP server 投影成工具名，channel 投影成名字。两个逐字节相同的 preset 目录放在两个地方，哈希必然相同。

这不只是从代码推出来的。T32 自己的真机轮从另一头测到过，当时为的是另一件事：第三个 scope 把 `eval-lean` 的内容换个 id 叫 `renamed-lean`，哈希与放 `eval-lean` 的那个 scope 逐字节相同。preset 的**名字**不是能力，它的**位置**也不是。

所以逐字节相等就是把测量从「catalog 读得到的那份」转移到「sub-dsh 实际跑的那份」的凭据，而证明这个相等就是守卫的职责。这是在 T32b 那个折衷（量的是实例的组合，不是 sub-dsh 的）之上再叠一层折衷，和那一层一样写进模块文档与两份 README。

### 搬家规则：`customSkillDirs` 不得是绝对路径

`skill-filesystem` 对每个 `customSkillDirs` 条目做 `resolve()`，绝对路径照抄、裸相对路径按 `process.cwd()` 解析——都不可搬家。组合行的 config 可以改带 `!!js` 表达式，loader 以 `with (ctx) { eval(expr) }` 求值（`vendor/loader/src/config/utils.ts`），而 `Include` 把该上下文的 `baseUrl` 设为组合文件自己的目录（`vendor/include/src/index.ts`）。官方 `cordis` preset 的写法：

```yaml
customSkillDirs:
  - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
```

一个字面串，在部署的 preset 根对、在 scope 里对、在单元里 `/creds/dsh/.agent-presets/<id>/skills` 也对。

由此立成规则：**用作评测因子的 preset，其组合里不得出现绝对文件系统路径。** 两端都拒——`snapshotScopePreset` 不复制这样的组合，`scopePresetProblem` 不让这样的副本被测量——因为复制与测量正是错误答案会被铸出来的两处，而只守一端就留一个口子（手工放进去的副本；复制之后又被改过的部署 preset）。两处的扫描都把 `!!js` 保留为**源文本**再解析（求值等于在宿主进程里跑 preset 文本），解析不了的组合一律报告无发现：那是 loader 的判断。

### 谁写什么——以及决定这件事的那颗重启地雷

`provisionDshSubProfile` 整份重写 `cordis.patch.yml`，而 local-agent 注册表**每个宿主进程里每个 (harness, scope) 只跑一次** scope 的 `provision` 钩子。于是手写的 roster 层被下一次重启静默抹掉，再 provision 就报「the scoped home rosters no readable preset」。pilot D 的装置是手写的，能活到现在只是因为中间没人重新 materialize 过那两个 scope。

所以 scope 组合哪个 preset 要**从 scope 自己**读得出来，就像它的 roster 层与权限边界已经那样：

- **`<scope>/sub-profile.json`** 写 `{"preset": "<id>"}`。`provisionDshScope` 按*显式参数 → scope 文件 → 插件 config* 解析，并把显式参数持久化进该文件。读不出来的声明——没有、坏的、id 不是目录名——退回部署的答案，而不是让 provisioning 失败。
- **`LocalAgentHarness.provision` 收 `(homeDir, options?)`** 并可返回一份回读；注册表新增 `provisionScope(name, scope?, options?)`。另三家收下参数并忽略，provisioning 逐字节不变。`provisionScope` 与 materialize 的三处不同正是它存在的理由：它**等**（包括等掉它自己刚触发的那次 materialize，两个写者写的是同一批文件）、它**抛**、它把 scope 现在持有什么**交回来**。
- **`conditions provision` 调它**，对声明了 preset 的条件，作为第 3b 步——在哈希作用域目录**之前**，因为 scope 自带的那份 preset 副本就在作用域目录里面。门面没有这个动词就退回从前：有什么读什么。这一步抛错是一条 `SCOPE_NOT_PROVISIONED` 警告而不是中止：决定这条条件有没有受试对象的是回读，不是这次调用的成败。

这也是 pilot D 记下的第一条缺陷的修法。`local-agent-dsh` 的 config 是实例级的，「两个 scope 各 roster 一个 preset」因此表达不出来；有了 per-scope 文件与这个动词，做主的是条件文档——评测的因子本来就该待在那儿。

**快照只由带显式 `preset` 的那一次刷新**——实践中就是 `conditions provision`，铸新 lock 的那一下，也正是该接住「正本被改过」的那一下。其余任何一次 provisioning 只在副本**不存在**时复制，存在就原样留着并报告它是否仍与源相同。run 底下的受试对象不许被任何东西挪动。

`eval` 不往 scope 里写任何东西。

### lock，以及它不记的那一样

`provisioned.capabilities` 多两个键（协议 **v1-rev12**，在 T31 那个可加块内可加）：

- `snapshot: {sha}`——对整棵 `<scope>/.agent-presets/<id>` 的 sha256，**每一个**文件都算、`SKILL.md` 也算，流的形状照 `hashHome`。`home.sha` 只哈希配置后缀的文件，技能正文改了它记的东西一样不动；看得见这件事的就是这一条，而且离线看得见。
- `source: "scope-snapshot" | "instance-root"`——测量是以哪种方式转移过来的。

**不记部署根的路径。** lock 是要提交进题库仓库的被评审数据，而 `unit.ts` 立的规矩是这类文件里不出现宿主路径。内容哈希本来也是更好的出处：路径说的是有人去哪儿看过，哈希说的是两份副本当时相同。

有一件事是白得的：快照里的 `agent.cordis.yml` 与 `preset.yml` 是作用域目录里的 `.yml`，所以 **`home.sha` 现在也随 preset 而动**。只差 preset 的两条条件被 `home.sha` 以更锋利的理由分开，而改一个 preset 会重新哈希条件。

### 就绪检查与 validate，以及 T32b 关不掉的那个缺口

就绪检查重算 scope 那份副本的哈希，不一致即拒——「scope 跑的这个 preset 在 provision 之后变了」——不碰 catalog、不发委派、不花 token。原有的 catalog 重量原样保留，回答它自己那个问题。算不出来时locked 记录照旧算数，与算不出能力面时一样。

`resolveConditionReadiness` 多收一个可选的 `scopeHomeDir` 解析器，离线做同一条检查；`EvalService` 从挂着的 local-agent 门面把它交给 `validatePlan` 与 `listConditions`。T32b 记下却关不掉的那句——*「validate 仍然把过期的 lock 报成 ready……它是离线的，量不了」*——就此对改技能正文这一类关上：validate 量不了能力面，但它能哈希一个目录。没有解析器（纯 CLI）时它与从前逐字节相同。

### 什么没变

不声明 `preset` 的条件碰不到这里的任何一样：`provisionScope` 只为声明了 preset 的条件调用，守卫只为这种条件查询，lock 的新键只在有快照时出现。`presetRosterLayer(undefined)` 照旧返回 `''`，不组 preset 的 scope 不会多出副本、声明文件与 roster 层——有一条比对生成 patch 的测试钉住。

## Alternatives considered

**把部署的 preset 根挂进单元（文案里的备选）。** `unit` 段是 `additionalProperties: false`，这是一次 plan 契约的改动；plan 是被评审数据、不得携带宿主路径，于是路径要来自一个新的门面动词、由 eval 注入；`unit.ts` 的「恰好一个挂载」契约变成两个，环境指纹还得把第二条挂载算对。而且 roster 仍点名一条宿主路径，正本一搬家、或部署的 `DSH_HOME` 一不同，这套就死。它唯一的好处——绝对 `customSkillDirs` 继续能用——被搬家规则抹掉，用的还是官方 `cordis` preset 已经证明可用的写法。否决；只在 `!!js` 求值真机不成立时才轮到它。

**给 catalog 加一个「按目录给 preset 打指纹」的动词。** 它能直接量 scope 那份而不靠相等推导，也是这个问题的诚实形状。代价是 `capability-catalog` 的服务面、它的 `@Remote` 面、eval 的 face，再加 roster 为临时根走一条 mount 路径——换来的性质逐字节相等已经给了，而这次测量本身就是一个已声明的折衷、且预定要被 in-scope 测量取代。哪天有因子需要一个**只存在于 scope 里**的 preset，该建的就是它。

**教 roster 的 `roots` 写一条两侧都对的路径。** roster 只展开开头的 `~`；两侧都对的路径恰恰是 `$DSH_HOME/.agent-presets`，即缺省用户根。这个备选自己塌回本决定。

**把 scope 的副本做成指向部署根的软链。** `hashHome` 跳过软链并计入 denied，受试对象就不再被哈希；指向宿主路径的软链在单元里解析到虚无。

**让 eval 自己写 roster 层。** 按 T32b 为「读」记过的同一条理由否决：patch 的格式归 `local-agent-dsh`，而它在 materialize 与每一次宿主轮都会重新生成这个文件。给一个由别的包重新生成的文件加第二个写者就是漂移发生器。

**把 per-scope 的 preset 写进插件的实例级 config（`presetByScope`）。** 因子会待在实例的设置里而不是数据集里，而且不随 bind mount 走。scope 目录两条都满足——roster 与权限边界已经住在那儿正是为此。

**漂移了就静默自愈，而不是报告。** 否决：副本与部署那份不一致是测量必须看见的事实。自愈等于让受试对象在 run 底下移动，而那次漂移永远不会走到任何一份 lock 或任何一次就绪拒绝里。

**保留 T32b 的守卫，接受「带 preset 的条件只能跑宿主轮」。** 这就是 pilot D 停住的那个状态，也正是让它的判据在两条路上都证不出来的原因。

## Testing

- `packages/local-agent/tests/scoped-home.spec.ts`：`provisionScope` 等掉它可能刚触发的那次 materialize（两次调用都被观察到、顺序正确、第一次不带选项）、把该家的回读交回来、把该家的失败抛出来，对没有钩子的 harness 则是一次仍解析出目录的空操作。
- `packages/local-agent-dsh/tests/scope-preset.spec.ts`：scope 声明可往返且幂等，每一种读不出来的形状都退回；`compositionAbsolutePaths` 放过 `baseUrl` 写法、抓住裸绝对串与藏在表达式里的那一条、对解析不了的 YAML 无发现；`snapshotScopePreset` 逐字节复制、已有副本原样留着但**报告**不一致、refresh 时重新同步、refresh 无变化时不写、并拒绝绝对路径 / 源不存在 / 树里有软链；`provisionDshScope` 写的 roster 不带 `roots`、不带任何选项也能复现该 scope 的 preset（重启路径）、三级解析序、以及不组 preset 的 scope 逐字节不变。
- `packages/eval/tests/preset-snapshot.spec.ts`：哈希是内容寻址的（同样的字节、两个地方、两个名字、一个哈希）、改技能正文会动、每个文件都算、软链树与不存在的目录都读作 undefined；组合扫描与 `scopePresetProblem` 的两面。
- `packages/eval/tests/capability-probe.spec.ts`：`scopeKeepsOwnPreset` 两面；探针对不持副本的 scope 记 `instance-root`，对没人担保的副本与被报告为不一致的副本都拒测（并证明 catalog 根本没被问），对带绝对路径的副本拒测，对有担保的副本记下树哈希与 `source`；provision 在哈希作用域目录之前组 preset（写回记录的 home 哈希包含它）、对不声明 preset 的条件从不组、组失败记 `SCOPE_NOT_PROVISIONED` 并照样按 scope 实有之物 provision、门面没有动词时退回；`capabilityRefusal` 对快照哈希的三种情形；`checkReadiness` 在**完全没有 catalog** 的情况下判掉一条副本变过的条件且不起委派。
- `packages/eval/tests/capabilities.spec.ts`：离线回读——没变时 ready，改过技能正文后 `CAPABILITIES_SNAPSHOT_STALE`，没有解析器时沉默。
- `packages/eval/tests/protocol.spec.ts` 把发布出去的 lock schema 与它的示例钉在代码上。

## Consequences

- 声明了 preset 的条件在容器路径上跑得起来了——这正是 pilot D 需要、而本仓此前给不出的东西。
- scope 组哪个 preset 是条件文档的属性而不是部署插件设置的属性，并且熬得过实例重启。pilot D 记下的第一条缺陷关闭。
- 作因子的 preset 必须可搬家。pilot D 的两个 preset 各带一条绝对 `customSkillDirs`，已在题库仓库改写成 `baseUrl` 表达式；两个 `caps` 哈希不动（面里没有路径、技能也没变），两个 `home.sha` 都动（副本现在在作用域目录里面）。
- `validate` 与 `conditions list` 第一次能对一份过期的 lock 表态——在它们跑在有 local-agent 门面的地方时。纯 CLI 不变，能力面本身仍要活的 catalog。
- `local-agent-dsh` 为那次组合扫描多了一个 `js-yaml` 依赖，与 `local-agent-dsh-headless`、`eval` 一致。
- 现在有两个包各自持有一份 preset 组合扫描与一份目录哈希。eval 不 import 任何兄弟包，所以这份重复是那条规则的代价，两边各由自己的测试钉住——与 `canonicalJson` 已有的安排相同。
- 仍然推迟：量到的面仍是实例对该 preset 的读数，而非 sub-dsh 自身组合的面。`capability-probe.ts` 依旧是 in-scope 测量将来替换实例读数的那个地方，而在那之前写下的每一份 lock 对它都读作过期——就绪闸把这件事变成「重 provision」而不是一次静默的错配。
