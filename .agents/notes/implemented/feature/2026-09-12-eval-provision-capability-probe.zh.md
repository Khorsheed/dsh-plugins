# Agent Note: 把 T32 的能力钩子接上——以及在 run 起来时再量一次

Status: implemented

[English](2026-09-12-eval-provision-capability-probe.md) | 中文

## Problem

T32 在原理上让条件的 `preset` 可核对，把测量留成了钩子（`ProvisionOptions.capabilities`）。没有任何东西接它。于是每一条声明了 preset 的条件都落成不带能力记录的 lock、报 `CAPABILITIES_UNMEASURED`、再被就绪检查拒掉——pilot D 要变的那个字段，根本到不了 ready。整套机制除了「产出那个数字」的那一步之外都齐了。

还有第二个更安静的缺口，T32 没有堵上。假设钩子接上了：lock 记下一个哈希，然后**再也没有任何东西拿它跟什么比过**。`validate` 是离线的，量不了；就绪检查只核对记录**在不在**、记录里的 preset **对不对**。provision 之后有人改了那个 preset，lock 会永远读作「已核对」——而改技能**正文**不会动任何别的已记哈希，因为 `home.sha` 只哈希配置后缀的文件，`SKILL.md` 不在其中。能力哈希存在的意义正是看见那次修改，而没有人在看。

## Decision

### 探针在实例里量，并且把「这意味着什么」说出来

`instanceCapabilityProbe` 就是 `EvalService.provision` 在组合里挂着 `capabilityCatalog` 服务时交给 `provisionCondition` 的那个钩子。三步，每步都能拒：

1. **回读 roster。** `readScopePreset` 扫作用域目录下每个 `profiles/*/cordis.patch.yml`，找挂 `@deepseek-ai/dsh-agent-presets` 的 insert 行，取它的 `default`。读不到就不测量——把声明抄进 `provisioned.preset` 是唯一会让这个字段失去意义的做法，因为「它是一次回读」就是它的全部内容。
2. **确认两边说的是同一个目录。** catalog 按**评测实例**的 roster 根解析 preset id，子 dsh 按作用域目录的根解析。作用域目录里自带一份 `<scope>/.agent-presets/<id>` 时，同名不同物，而 catalog 会心安理得地去哈希实例那一份。`scopeDefersToInstancePresets` 把这种情况变成一句带修法的拒绝（把子 profile 的 `roots` 指到实例的 preset 根上），而不是一个错的数字。
3. **量。** `snapshotFor(<回读到的 id>)`，取快照自带的 `sha`。T32 已经让「点名的 preset 挂不起来」**抛错**而不是退回全局层，那句拒绝在这里同样是正确答案。

**它量的是什么，写出来而不是暗示**：该 preset 的能力面**在这份实例的 composition 里**的样子，不是子 dsh 那份（dsh-base + headless patch + roster）。作为因子它是真的——两个 preset 两个哈希，改技能正文哈希就变——这正是 pilot D 要的。它不是子 dsh 的整张面，README 两个语种都写明了。

### 就绪检查再量一次

`capabilityRefusal` 多收一个参数：**此刻**量出来的那张面。不相等就在花掉任何一次委派之前判该条件不就绪，点名「preset 在 provision 之后变了」，并给出修它的命令。`run.ts` 用它本来就为 `run.meta.orchestrator` 解析的那个可选 catalog 面来供给；没有 catalog 的组合保持 T32 的闸原样（在不在、对不对，不比新鲜度）。

**量不出来时，原记录照旧算数。** 测不到是关于 catalog 的证据，不是关于受试对象的；因为服务打了个嗝就拒掉一个 run，会让格子为一个跟它在测什么毫无关系的理由失败。

这也正是那条被押后的「在子 profile 内测量」将来能安全落地的原因：等真正量的是子 dsh 自己那份 composition 时，所有由实例读法写下的 lock 都会与它不符——而闸把这件事变成「去重新 provision」这句正确的指令，不是一次无声的错比。

### 拒测的探针现在会进报告

T32 的 provision 在探针返回 `undefined` 时只 log 了 `capability face NOT measured`，不推任何诊断——这与同一个文件里往上三段写着的探针契约自相矛盾。现在「拒测」与「抛错」一样推 `CAPABILITIES_UNMEASURED`，否则 `conditions list` 与 slash 输出上看到的是一份看起来很完整的 lock，只有日志知道实情。

### 刻意去读兄弟包的文件

`sub-profile.ts` 读的是 `@khorsheed/dsh-local-agent-dsh` 写出来的文件。eval 不得 import 兄弟包，也没有任何服务面报告 roster，所以它认的东西是挑过的、稳的那部分：loader 的 patch 格式，与 roster 的**包名**，两者都是公开契约。生成的注释横幅与 profile 目录名**明确不认**——子 profile 的名字可配，所以作用域目录下每个 profile 都扫；两个 profile roster 着两个不同 preset 时读作「有歧义」，而不是取先找到的那个。

真实子 profile patch 里满是的 `!!js` 标签，经一个收窄过的 js-yaml schema 解析成 `undefined`。它们是**loader** 的、从来不是这个读者的：在这里求值等于把 profile 里的文本当代码在编排器里跑。

## Testing

- `packages/eval/tests/capability-probe.spec.ts`：
  - `presetFromPatch` 对着 `local-agent-dsh` 真正生成的那个形状（含它的 `!!js` 行）；垃圾输入、空文档、没有 `default` 的 roster 行都读作「没有」；换了 row id、抹掉注释横幅照样读得到。
  - `readScopePreset`：改名的 profile 目录、没有 profiles 的 scope、不 roster 的 scope、两个 profile 互相矛盾。
  - `scopeDefersToInstancePresets` 两个方向。
  - 探针：顺路径的摘要与计数；声明不一致时量的是**作用域** roster 的那个；四种拒测（无 roster、作用域自带副本——并证明 catalog **根本没被问**、catalog 抛错、面上没有摘要），外加 `hashOf` 兜底。
  - `capabilityRefusal` 的新鲜度：相等放行、不等按名拒并给修法、量不出来时原记录照旧。
  - `checkReadiness`：preset 变了则不起任何委派就失败（门面的 `start` 一被调用就抛）、没声明 preset 的条件从不重量、重量抛错时条件仍 ready。
  - `EvalService.provision`：挂了 catalog 时测到的面进 lock；没挂时保持 T32 的降级；没声明 preset 的条件从不问 catalog；作用域不 roster 时报 warning 而不是写个猜测。

## Alternatives considered

**直接哈希条件**声明**的那个 preset，不回读作用域。** 否决。那样它永远成功、永远与声明一致，并把 `provisioned.preset` 变成它本该作为对应物的那个字段的副本。这一段的全部价值就在于它**能够**不一致。

**让 eval 从 `@khorsheed/dsh-local-agent-dsh` import `readSubProfilePreset`。** 否决：社区插件从不依赖兄弟包，而 eval 的独立性是承重的（CLI 在完全没有插件树的情况下消费它）。以两条公开契约为键去读那个文件，是这条规则诚实的代价；另一条路——给 local-agent 面加一个 roster 动词——是为一个读者去改另外两个包。

**用正则匹配生成的注释横幅（`local-agent-dsh` 自己的 `readSubProfilePreset` 就是这么做的）。** 在这里否决。那个函数在**写**横幅的那个包里，横幅对它而言就是自家契约；从外面看，认注释就是认散文。解析 YAML 多几行，却扛得住改写的横幅、换掉的 row id 和手改过的 patch。

**作用域自带 preset 目录时，是拒测还是照样哈希实例那一份。** 选拒测，因为它防的是**无声**的那种失败：同名、不同内容、一个看着挺像的哈希，以及两条条件靠一个谁都没描述的数字看起来像两个受试对象。这条守卫也正是「在实例里量」这个折中之所以还站得住的原因。

**就绪检查的重量测不出来时判拒。** 否决。lock 是关于受试对象的证据，catalog 在不在不是。为服务打嗝而拒掉一个 run、还给一条关于能力的消息，只会把人支到错误的地方去查。

**在 lock 里记一个 `takenIn: 'orchestrator'` 标记，让 lock 自己说清是哪份 composition 量的。** 本次否决，虽然写过草稿。它要改 `dataseek.condition-lock/1`、因而要动协议文档，而本分支的范围里没有它；而且有了新鲜度重量之后，旧量法写的 lock 不会再无声通过——它读作过期并说「去重新 provision」。将来那条在子 profile 内测量的改动如果想**区分**两者而不只是让它们失效，该由它来加这个字段。

## Consequences

- 声明了 preset 的条件可以到 `ready`——pilot D 解锁，这正是本次的目的。
- 就绪检查在 run 起来时对每条声明了 preset 的条件多一次 catalog 调用。不过模型、不过委派，且只对声明了 preset 的条件。
- 记下的哈希是**实例**对该 preset 的读数，不是子 dsh 的整张面。两个 preset 仍是两个哈希、改技能正文仍会动它，所以作为因子成立；需要知道这个差别的读者在 README 与 `capability-probe.ts` 的模块注释里找得到。
- 测量要求作用域的 roster 与实例的 roster 把同一个 preset id 解析到**同一个目录**——实践上就是子 profile 的 `roots` 指到实例的 preset 根。自带 preset 副本的作用域会被拒测，并附上这条修法，而不是被量错。
- `capability-probe.ts` 就是将来那条「在子 profile 内测量」替换实例读法的地方。换的时候别处不用动：lock 字段、就绪比对、provision 的接线都照旧。
