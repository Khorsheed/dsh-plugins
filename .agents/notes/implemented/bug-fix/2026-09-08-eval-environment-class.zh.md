# Agent Note: 环境不变量比的是环境类，判定目录按题库真实路径物化，物化哈希两条路径统一

Status: implemented

[English](2026-09-08-eval-environment-class.md) | 中文

## Problem

T20 让 `refs.fingerprint` 取单元的 lab 复合指纹，「环境一致」在一家一格的 run 上从 `unverifiable` 变成 `ok`。而在整个 profile 存在的理由——四家横比——上，它直接变成 `violated`。

复合指纹的分量含挂载布局与注入的 env **键名**，而容器路径下每个条件各挂自己的凭证目录、各在自己的容器内路径上、各由自己的变量指向：`CODEX_HOME`、`CLAUDE_CONFIG_DIR`、`KIMI_CODE_HOME`、`DSH_HOME`。四家同一个 run 必然四个指纹，不变量记 `violated`，报告拒绝输出任何比较。而这四个环境是同一个镜像、同一组上限、同一个网络、同一个 user，差的全是「让每个受试对象成为它自己」的那几项。

随之而来两件小的。T19c 发现 register 布局的题，判定目录里多出一段题库里并不存在的 `verify/`（文件真在 `items/P0/checks/probes/x.mjs`，却被物化到 `items/P0/verify/checks/probes/x.mjs`），题内探针到题集级 lib 的相对路径就差一层，只能自带一份副本——任何 register 布局的真题都会踩。以及 T20 的容器路径把 lab populate 的 manifest 哈希当作物化哈希记，宿主路径记的是编排器自己那套，于是「题面一致」只能在单条路径内部回答。

## Decision

- **不变量比的是计划声明的那个环境。** `refs.fingerprint` 记**环境类**：单元的分量减去该条件自带的那几项——作用域目录的挂载 target、指向它的变量名、该 harness 的额外变量（dsh 的 `NODE_OPTIONS`）、条件 `env.keys` 里声明的键。剩下的是 image、资源上限、network、user 与计划级的挂载和 env 键。「同类不同单元」不是和稀泥，那本来就是报告在问的那个问题。
- **减法照着造 spec 的那段代码反着读。** `acquireSpecFor` 放进去哪几项，`conditionOwnedComponents` 就取回哪几项，因此这个集合是构造出来的精确集合，而不是按分量名做的模式匹配。条件声明的 `env.keys` 一并算进去：受试对象自己的凭证属于受试对象，不属于环境。
- **哈希规则不复刻。** lab 的服务面加一个纯函数 `fingerprintOf(components)`——就是 `acquire` 用的那个哈希函数本身——eval 经它算环境类。复刻出来的第二套规范化会在下一次加分量时漂移，而派生出来的类必须与「用这组分量 acquire 出来的单元」的指纹天然相等，不能靠巧合。标签仍是 `lab-env:<sha256>`，分量 `version` 不动：同一套算法作用在少了几项的分量集上。
- **单元自己的指纹照记，报告照印。** 它连同被排除的项记在该格的 `unit` 注解里，lab 的归档 manifest 也照旧带着它。报告在不变量那一行下面逐格列出每格的单元指纹与被排除的挂载 target 与 env **键名**（绝不带值），于是「同类不同单元」是读者看得见的事实，而不是要信的说法。它**不进 refs**：mission 的 refs 只写 `resource` / `fingerprint` / `sessions`，加第四个键是 mission 的改动，不属于本任务。
- **判定目录复现题库的真实相对路径。** item 的层文件：约定式落 `items/<id>/<layer>/<display>`，被 register 归位过的落 `items/<id>/<display>`——这本来就是两种 display 各自的含义。哪个是哪个，从 `datasets.show` 已经在返回的 descriptor 里读 `register` 判断；面上是可选字段，不报的门面退回约定式。探针的 `by` 仍是 display 路径：那是判定的出处，不是位置。
- **探针的 cwd 是该题 checklist 所在的目录。** 约定式是 `items/<id>/verify`，归位后是 `items/<id>/checks`——于是共享探针的 `./checklist.yml` 在两种布局下读到的都是这道题自己的那份，这也正是「cwd 是该题 verify 层的根」一直以来的意思。没有 checklist 的题回退到约定根。
- **一份物化哈希，两条路径。** `materialization.json` 归编排器，宿主与容器里按同一套算法算，因此同题同 commit 得到同一个数。lab 那份「拷进单元的是这份」的哈希换名单独存在 `populate-manifest.json` 里——那是另一个主张，不是同一个数的第二种写法。

## Real-machine verification

真 docker，真 lab / mission / datasets 服务，T16 冻结的镜像，`eval-net`，user `1000`。四个只差作用域目录的条件，各一格，四格全部 `released`。报告不变量一节原文：

```
- **环境一致（refs.fingerprint 同 run 相同）** — ✅ 成立
  - 4 格指纹一致: lab-env:dcca…
  - 每格的单元指纹（含条件自有项，因而各不相同）与被排除的条件项：
  -   …claude-unit-rep1: lab-env:46c8df90eb84… — 排除 挂载 /creds/claude、env CLAUDE_CONFIG_DIR
  -   …codex-unit-rep1:  lab-env:5787bf0707fd… — 排除 挂载 /creds/codex、env CODEX_HOME
  -   …dsh-unit-rep1:    lab-env:b5ae4002ff10… — 排除 挂载 /creds/dsh、env DSH_HOME、env NODE_OPTIONS
  -   …kimi-unit-rep1:   lab-env:229995ada121… — 排除 挂载 /creds/kimi、env KIMI_CODE_HOME
```

四个单元指纹、一个环境类，差异被点名。「题面一致」是 `8b38bb4698fa… × 4 格一致`；同题同 commit 的宿主路径 run 记的是 `8b38bb4698fa110fdf4054e4c34e59d9c2f22cf7721f2c9c1ea6ed12fcb0f073`——与容器格记的是同一个数，这正是统一算法买到的东西。

pilot A 的 bundle 复算后 `results.jsonl` 逐字节一致，「环境一致」那行也一字未变（`⚠️ 无法核验 · 本 run 无指纹`）：没有指纹的 run 仍然没有。

register 布局用夹具题验证而不是 P0：同一个探针以 `../../../../verify/helpers/lib/kit.mjs` 引题集级 lib，在两种布局下都判定成功；共享探针在 register 题里从它自己的 `checks/` 读到 checklist。（把 P0 探针的副本删掉、改回 import 题集级 lib 是题库改动，归 T22。）

## Alternatives considered

**把 `mounts` 与 `envKeys` 从 lab 的复合指纹里去掉。** 拒绝：它们是环境事实。多挂一个卷、多注入一个变量的单元**就是**另一个环境，指纹说不出这件事，就等于让报告批准一次它无权批准的比较。评测需要的是对同一组分量问一个更窄的问题，不是给所有人一个更钝的指纹。

**在 eval 里给环境类另写一套哈希规则。** 拒绝：一套规范化的两份实现会漂移，而第一个症状恰恰是「类不再等于用这组分量 acquire 出来的单元的指纹」——那正是类之所以有意义的性质。所以在 lab 上加纯函数。

**给类的哈希换一个 `version`。** 拒绝：规则没变。`version` 编的是哈希规则，不是分量清单（那是 `ADDITIVE_COMPONENTS` 的事），动它会让仓库里每个指纹都因为一次没有改变任何环境的改动而移动。

**把单元指纹写进 `refs.unitFingerprint`。** 想这么做，没做成：mission 的 `setRefs` 只写三个键，别的静默丢弃，于是这次写入会是一个看起来像记录的空操作。改由注解与归档 manifest 承载，报告读注解。

**按 display 路径的形状判断 register 布局**（比如「首段不是层名就是被归位过的」）。拒绝：约定式 display 的首段同样不是层名（`probes/x.mjs`），这条规则会把每一道约定式的题都放错。descriptor 本来就在线上，而且说得精确。

**用 `datasets.worktree_path` 物化两个 verify 层**——真实路径直接就有（架构第 16 步也是这么画的）。推迟：那会把答案键放进共享、去重、保留的 worktree 库里，而这一层的全部纪律就是「不活过它的用途」。在用完即弃的判定目录里复现路径能保住这条性质。

**容器路径继续用 lab 的 populate 哈希当 `materialization.json`，让报告学会跨算法比较。** 拒绝：没有东西可学——同一批字节按两套规则得到的两个哈希就是不可比的，而这条不变量的全部内容就是一次比较。

## Consequences

- 「环境一致」对这个 profile 真正要跑的那场比较可答了，T22 第 5 步解除阻塞。
- image、上限、network、user，或**计划级**的挂载与变量有差别的 run 仍然记 `violated`——环境类是把问题问窄，不是把它问软。
- 容器路径现在每格写两份记录，`materialization.json` 与 `populate-manifest.json`，bundle 两份都带。它们回答不同的问题，不相等不是故障。
- 门面不报 descriptor 的题库保持约定式布局，与从前相同；这种门面上的 register 题仍按旧样物化，探针仍够不到题集级 lib。修好这件事需要 descriptor，明说比猜好。
- `registerPatternMatches` 是作者协议那条 glob 规则在 eval 里的六行复述，用同一批用例的测试钉住。社区插件不 import 兄弟包，这与 JSON Schema 子集校验器早就做过的是同一笔交易。
