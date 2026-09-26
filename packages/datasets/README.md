# dsh-datasets

[English](README.en.md) | 中文

git 仓库之上的通用版本化数据集存储：分层 item、从 git 对象直读的 commit 钉版读取、整层消费的只读物化视图（`git archive`，按内容寻址）、以及部署级的题库登记——agent 只能按登记引用 `<id>/<set>` 取数据，层白名单在所有读取路径上强制。

本插件存在的理由是文件浏览器没有的三样东西：**语义契约**（descriptor 形状校验、层可见性类别、item 元数据 schema 声明）、**版本固化**（snapshot、git 对象直读、按 commit 寻址的只读物化目录）、**访问治理**（人写的题库登记 + 机制化而非约定化的层白名单）。插件从不解释数据集的语义，也从不把内容复制出仓库。

## 数据集仓库布局

数据集存储就是一个普通 git 仓库。目录结构是约定，层名任意、由 descriptor 声明。层目录可以存在于**两个级别**——题集级层放跨 item 共享的内容，item 级层放单个 item 的内容：

```
<repo>/
  datasets/<dataset-id>/
    dataset.json           # id、name、layers 清单（可见性类别）、item 元数据 schema
    <layer>/...            # 题集级层（以 layers 清单声明的名字命名的顶层目录）
    <任意其他文件>          # descriptor 透传——原样携带、不读、读取路径不可达
    items/<item-id>/
      item.json            # item 元数据（字段由声明的 schema 约束）
      <layer>/...          # item 级层
```

版本 = git commit。插件只校验 `dataset.json` 的**形状**：`id`、可选 `name`、可选 `canary` 串、非空的 `layers` 清单（每项声明 `name`，可声明 `modelFacing: false`，缺省 true）、可选的 `itemMetaSchema` 对象。其余字段原样透传。

两级规则纯粹按名字判定：顶层目录的名字若声明在 `layers` 清单里，它就是题集级层；其余任何顶层文件或目录都是 descriptor 透传，与之前一样置身 `list`/`show`/`read`/`worktree_path` 之外。`items` 是保留的 item 容器，不能用作层名。所有机制在两级统一生效：登记的层白名单（列表过滤、读取拒绝、物化的 archive 路径同时覆盖 `datasets/<id>/<layer>/` 与 `datasets/<id>/items/*/<layer>/`）、`modelFacing` 可见性类别（声明按层名，天然两级适用）。评测题集布局里，跨 item 共享且有可见性要求的内容就放在这里：`suites/<suite>/verify/helpers/` 放题集级层（判定时才挂载），评分 rubric 也从散落的顶层目录收进声明过的题集级层，白名单才真正管得到它们。

`modelFacing: false` 是数据声明，语义仅一条：该层离开本机的导出必须过人工确认闸（确认闸由导出方实现，不属本插件）。它与登记的层白名单是两层独立机制——白名单管「agent 能看什么」，导出闸管「什么能离开本机」。

descriptor 还可带可选的 `register` 数组（数据集作者协议 §2）：把 item 目录内的自由文件显式注册进 item/层角色——`register: [{item, layer, files}]`，files 是 item 相对路径或单层 glob（`*` 不跨 `/`）。注册的文件在 list/show/树上归位到声明的层角色（物理位置与角色解耦），物化的 archive 路径覆盖注册路径；路径越界、`**`、与布局形态冲突、精确路径不存在都会 fail loud。完整约定见根目录 `docs/dataset-authoring-protocol.md`。

层缺省 `modelFacing` 为 `true`。因为 descriptor 文件会被当模板抄，形状校验还会**告警**（绝不阻断）：在混合敏感度数据集（存在任何显式 `modelFacing: false` 层）里，每个未显式声明该键的层各产生一条警告（`MODELFACING_UNDECLARED`，逐层）。纯公开数据集（没有任何 false 层）与逐层显式声明（无论 true/false）的数据集不产生警告。警告随数据集摘要走：CLI 在 `list`/`show`/`describe` 时打到 stderr，slash 命令附在输出末尾，web tab 在数据集行下以安静行呈现。

**金丝雀（泄题取证）**：descriptor 可声明 `canary`——一个全局唯一串，建议格式 `dsh-canary:<dataset-id>:<uuid>`。声明之后，`validate` 检查每个可见层（`modelFacing: true`；题集级与 item 级都算，register 归位的文件按其角色层算）里的文本文件是否逐字包含它，缺的逐文件报 `CANARY_MISSING`。文本按扩展名白名单判定（`.md` / `.txt` / `.yml` / `.yaml` / `.json` 与无扩展名），其余文件跳过；敏感层与 item.json 不在检查范围。用途是日后拿这个串去搜模型的输出：搜到即证明本题库进过训练语料，成本几乎为零。插件只校验，从不生成也从不注入金丝雀——串由作者自己造、自己埋。未声明 `canary` 的数据集完全不做此检查。

**可判性（一道题能不能被判，开跑前就知道）**：item 的 grading 层若带 rubric（层内 display 路径中文件名为 `rubric.yml` / `rubric.yaml` 者，多个取最短路径——约定式的 `rubric.yml` 与 register 改户的 `answers/rubric.yml` 都覆盖到），`validate` 就检查这份 rubric 判不判得动。只有 axes 没有叶子的 rubric 能过所有形状校验，然后三个判定源（探针、LLM 判官、判官台）读的全是叶子，一个都写不出判定：格子逐个记 judge-skipped，verdicts 为空，永远过不了归档闸——这是题库侧就能机械查出的事实，不该由一次 run 一格一格地发现。层名 `grading` / `verify` 取自数据集作者协议 §6.7/§6.8 的判定约定（编排器挂载的正是这两个名字）；grading 层里没有 rubric 的 item 完全不做此检查，因而不在判定约定里的数据集报告与从前逐字相同。

### `validate` 规则表

| 级别 | 代码 | 触发条件 |
|---|---|---|
| error | `SHAPE_INVALID` 等 | descriptor / item.json / register 的形状错误。逐数据集 fail loud，其余数据集照常校验 |
| error | `RUBRIC_UNREADABLE` | rubric 不是可读的 YAML 文档，或在该 commit 上读不出来 |
| error | `RUBRIC_NO_ITEMS` | rubric 没有叶子判据（`items` 缺失或为空）。只有轴判不了——判定源读的都是叶子 |
| error | `RUBRIC_FIELD_MISSING` | 某条叶子缺 `id` / `axis` / `weight` / `kind` / `criterion` / `evidence`（`weight` 是数，其余是非空字符串）。逐叶子一条，一条里列全缺的字段 |
| error | `RUBRIC_KIND_INVALID` | 叶子的 `kind` 不是 `objective` / `llm-draft` / `human`——第四种取值不通向任何判定源 |
| error | `RUBRIC_POLARITY` | 叶子的 `negative: true` 与 `weight` 符号不一致，两个方向都报。极性只声明一次：负分叶子带负权重，判定方从不再取一次反 |
| warn | `MODELFACING_UNDECLARED` | 混合敏感度数据集里未表态 `modelFacing` 的层，逐层 |
| warn | `FIELD_NAME_SENSITIVE` | item.json 里出现 note / hint / answer / rubric / grading 词根的键 |
| warn | `UNREGISTERED_FILES` | 未被任何层目录或 register 条目覆盖的文件——它们落在对每个 agent 都可见的透传区 |
| warn | `CANARY_MISSING` | 声明了 `canary` 的数据集里，某个可见层的文本文件没有逐字带上它 |
| warn | `OBJECTIVE_NO_PROBE` | 该题有 `kind: objective` 的叶子，但 verify 层下没有可执行探针（`probes/` 段里的 `.mjs` / `.sh`）。探针是 objective 判定的唯一写入方，没有探针这些叶子就没人判 |
| warn | `RUBRIC_REF_DANGLING` | `rubric.md` 引用了 `rubric.yml` 没声明的叶子 id。id 形状按正则宽松匹配，故意容许误报（看着像 id 的表格标号），因此只报警告——而陈旧引用不是误报 |

`kind: llm-draft` 只要有叶子即视为有源：判官由 plan 提供，题库侧看不见它。`kind: human` 不查——判官台是人。plan 有没有给判官、plan 的 `expectedNs` 与题的判定源对不对得上，归 `dsh-eval validate`；本插件的检查止于题库。rubric 无叶子或读不出来时，后两条警告不再跑：那时每一条引用都必然悬空，噪声会把唯一要紧的那条 error 埋掉。

内容以仓库内普通文件的方式进入数据集，走正常 git 流程提交；或由 agent 经 `datasets_put_item` 起草进工作树、人评审后提交。没有 import 动词：单文件从 git 对象直读，整层经只读物化目录消费。

## 安装与加载

本包是 dsh 插件，唯一身份 **`@khorsheed/dsh-datasets`**，在 `dsh-plugins` monorepo（`packages/datasets`）开发并发布到 npm：

```sh
npm install @deepseek-ai/dsh                            # 宿主（dsh web / dsh CLI）
dsh plugin --profile web add @khorsheed/dsh-datasets    # 本插件
```

包声明了 `dsh.bundle`，add 会把它的 `cordis.patch.yml` 行（裸 `datasets` 挂载）调和进 profile 的 bundles 层——不需要手改 cordis.yml。一个 composition 只能挂载 `datasets` 行 id 一次；`dsh --profile web --dump-config | grep datasets` 无输出即说明可以安全 add。

配置（可选）：`materializedRoot`（物化根覆盖；缺省 `$DSH_HOME/state/datasets/materialized`，否则 `<cwd>/.dsh-datasets/materialized`）。登记文件固定在状态根下：`$DSH_HOME/state/datasets/registry.json`。`tools` 不再是本行的键：模型工具的分组配置搬到了伴生行 `@khorsheed/dsh-datasets-tool`，见[模型工具](#模型工具)。

插件提供 `ctx.datasets` 服务供其他插件可选消费，挂载 `datasetsRemote` Typert Remote 服务（web 会话 tab 的数据面），并（在 composition 挂载 `@khorsheed/dsh-datasets/invariant` 时）于加载期检查物化根的结构完整性。`/datasets` slash 命令的**注册**自 preset 可见性收口（A3）起归伴生行——落进 preset 的 scope 层，只有授予会话可见；handler 与定义仍在本包，由伴生行调 `registerDatasetsSlash` 接入。`datasets_*` 模型工具与 `datasets:tools` 提示词段归伴生行 `@khorsheed/dsh-datasets-tool`，由 agent preset 按会话授予——见[模型工具](#模型工具)。

## 题库登记（T73）

题库仓库**按部署登记一次**，不再按会话绑定。登记表是状态根下的一个 JSON 文件（`$DSH_HOME/state/datasets/registry.json`），每条：

```ts
{ id, commonDir, trackedRef, registeredAt, registeredCommit, sets: { <set>: { layers } }, authoringCheckout }
```

- **身份是 git common dir 的 realpath**：同一仓库的主检出、它的 `.git`、它的任一 linked worktree 都是同一条登记，重复登记即拒（`ALREADY_REGISTERED`）。`id` 是 agent 引用里的 `<id>`，全表唯一。
- **「最新」= `git rev-parse <trackedRef>`，从不看 HEAD。** 共享检出的 HEAD 属于在里面干活的人；登记跟踪的是一条分支，分支前进，「最新」随之前进，不必重新登记。分支不存在即拒（`REF_NOT_FOUND`），登记仍在列表上并带一句原因。`registeredCommit` 只作审计，不参与解析。
- **可见层按题集记**：`sets` 里写了的题集按所写的层给 agent；没写的题集（包括登记之后才加到分支上的）拿 `modelFacing:true` 底线，在读时计算。写一个题集没声明的层即拒（`LAYER_UNDECLARED`）。
- **`authoringCheckout`** 是 `datasets_put_item` 唯一会写的工作树；没填就拒绝写（`NO_AUTHORING_CHECKOUT`）。读永远走跟踪分支的 git 对象，写永远进这个检出——提交与合并仍是人的事。

**登记是人的操作**：题集 tab 的「登记题库」表单（路径输入 + 系统选择器 + 实时预览；每个题集一行层 chip，缺省只勾模型可见层；跟踪分支下拉，缺省 `main`），或 CLI 的 `dsh-datasets register` / `update` / `unregister`。agent 没有写登记的工具。

**agent 只认引用**：模型工具的 `dataset` 参数只接受 `<id>/<set>`，拿不准时先调 `datasets_list`。三种错法各有一句能照着做的拒绝：

| 传的是 | 回答 |
|---|---|
| 一个路径 | 不收路径；若该路径已登记，点名应传的 `<id>/<set>`（`PATH_NOT_REF`） |
| 一个对不上唯一题集的名字 | 列出候选，并要求用 `ask_user_question` 让人选（`AMBIGUOUS_DATASET`） |
| 未登记的仓库或名字 | 「is not registered in this deployment」：请人去题集 tab 登记，**不要自己去读那个目录**（`NOT_REGISTERED`） |

第三条来自一次真事：agent 在没有数据的会话里被如实告知「让人来绑」，它没有停下，而是 glob 磁盘、找到一个多 agent 共用的检出，在别人的分支上写下三份文件。登记表让「找得到」与「可以用」分开：磁盘上有，不等于这个部署登记过。

**默认安全与边界对象**：层白名单约束的是 **agent 工具与物化视图**两条真边界；web tab 与 CLI 的读取动词是人的视图（operator scope），不受白名单与底线限制——敏感层对人照常展示并带「· 敏感」标记，树上另有「透传」分组把不受保护的内容显眼列出。白名单不是安全边界：同机的人可改登记，有 shell 的 agent 可读原仓库。它防的是误取和流程串味，不防恶意。

### 旧会话绑定

T73 之前每个会话绑一个仓库（`$DSH_HOME/state/datasets/bindings/<session>.json`）。T73 第二步起这条路**整个退役**：没有任何代码再读绑定（eval 的实验改为钉住自己的 `{登记 id, set, commit}`），`repo` 兜底配置、CLI `binding` / `unbind`、`/datasets unbind` 都已删除，写绑定的入口（`/datasets bind`、CLI `bind`、tab 绑定条、composer 绑定 chip）早已退役，`/datasets bind` 回答的是去登记的指引。唯一还碰这些文件的是下面的一键迁移，它只读。绑定文件**从不自动删除**：迁移确认无误后，可以手动删掉 `$DSH_HOME/state/datasets/bindings/` 目录。

从旧绑定迁移是一键的：tab 的「从旧绑定登记」（CLI `import-bindings`）把指向同一仓库的多条绑定合成一条登记，指向已不存在路径的绑定标红跳过；绑定文件本身逐字节不动，重复执行不会重复登记。

## 模型工具

**本包不再注册任何模型工具（BREAKING）**：下面这八个工具与 `datasets:tools` 提示词段归伴生行 `@khorsheed/dsh-datasets-tool`，由 agent preset 按会话授予。迁移两步：把伴生包作为依赖安装，并在目标 preset 的 `agent.cordis.yml` 里加两行——`- id: datasets-tool` 与 `  name: '@khorsheed/dsh-datasets-tool'`（该行可带 `config: { tools: authoring }`）。下面的清单、分组与行为描述自此描述的是**伴生行**的工具面；服务、CLI、`/datasets` 与会话 tab 仍归本包。

| 工具 | 写? | 作用 |
|---|---|---|
| `datasets_list` | | 列本部署登记的题集：`{ref, title, trackedRef, latest:{commit,date}, layers}`，不含任何路径；可带 `query` 过滤 |
| `datasets_show` | | 数据集/item 详情：摘要、descriptor 透传、层文件清单 |
| `datasets_describe` | | 原样透传 `dataset.json` descriptor |
| `datasets_read` | | 读 item 某层某文件，从 pin commit 的 git 对象直读——无拷贝 |
| `datasets_snapshot` | | 固化跟踪分支当前的 commit，仓库演进中读稳定版本 |
| `datasets_worktree_path` | 写物化缓存 | 整层只读视图路径（`git archive` 只取登记的层，按内容寻址） |
| `datasets_put_item` | 写工作树 | 在登记的 `authoringCheckout` 里创建/更新 item 元数据与层文件；没登记写入检出即拒；`git commit` 留给人 |
| `datasets_validate` | | 作者卫生 + 可判性校验：形状错误与判不动的 rubric fail loud；六类警告（混合敏感度未表态层 / item.json 敏感字段名 / 未覆盖文件掉进透传区 / 声明了 canary 但可见层文本文件没埋 / objective 判据无探针源 / rubric.md 引用悬空），警告不阻断。逐条见上面的[规则表](#validate-规则表) |

**工具分组**：`tools` 配置决定注册哪一组工具——preset 挑不掉 profile 层已注册的工具，能决定的只有注册本身。四档是一条包含链：`read` = 六个读类动词（list / show / describe / read / snapshot / validate）；`authoring` = read + `put_item`（起草进工作树，提交仍然是人的）；`all`（缺省）= authoring + `worktree_path`（整层物化，会写物化缓存）；`none` = 一个模型工具都不注册。系统提示词段只描述实际注册的工具，`none` 下连段都不贡献。服务、CLI、`/datasets` 与会话 tab 是人的面，任何档位都不动它们。**评测域建议 `authoring`**：规划期的 agent 要读题、要出题，但整层物化是编排器的动作，不该是 agent 能自己发起的一步。

`worktree_path` 返回物化根下的只读目录 `<repoKey>/<sha>/<set>/<layers-key>/`（`repoKey` 是 common dir 的哈希，所以同一仓库的所有检出共享缓存）：`git archive <sha> -- <层路径>` 解包进暂存区、去写权限、原子 rename 落位。键完全决定内容，所以同键再调是缓存命中（`reused: true`），并发创建者各自暂存、先 rename 的赢。返回形状 `{path, commit, layers, reused}` 与旧的托管 worktree 相同。它替换了托管 worktree：`git worktree add` 要在仓库**共享的** `.git` 里登记并加锁，每次物化都在写别人正在干活的检出的共享状态；`git archive` 只读对象，不碰 index、HEAD、worktree 列表。

## CLI

`dsh-datasets` bin 镜像工具的读取动词（同语义同名参数），另有登记动词。CLI 是人的面：读取动词的 `--repo` 收登记 id 或仓库路径；省略时用部署里唯一的那条登记（零条或多条都拒绝，并说明要传 `--repo`）。按登记 id 取时，`--commit` 缺省是该登记跟踪分支的最新提交；按路径取时缺省是 HEAD。退出码：0 成功，1 操作失败，2 用法错误。从 PATH 或 pnpm 的 `.bin` 软链调用与直连 `lib/cli.js` 等价：入口守卫先把 `argv[1]` 解析成真实路径再比对，软链路径不会让它静默空跑。

```sh
dsh-datasets list [--repo R] [--dataset D] [--commit C]
dsh-datasets show --dataset D [--item I]
dsh-datasets describe --dataset D
dsh-datasets read --dataset D --item I --layer L --path P [--commit C]
dsh-datasets snapshot --dataset D
dsh-datasets validate [--repo R] [--dataset D] [--commit C]
dsh-datasets worktree path --dataset D [--layers a,b] [--materialized-root DIR]
dsh-datasets registry [--state-root DIR]
dsh-datasets register --repo R [--id ID] [--tracked-ref B] [--set-layers set=a+b,…] [--authoring-checkout P]
dsh-datasets update --id ID [--tracked-ref B] [--set-layers set=a+b,…] [--authoring-checkout P|none]
dsh-datasets unregister --id ID
dsh-datasets import-bindings [--state-root DIR]
```

登记动词写 `--state-root`（缺省 `$DSH_HOME/state/datasets`）下的 `registry.json`，每次调用现读，所以登记后运行中实例的下一次工具调用即可看到。`bind` 已退役，回答的是 `register` 的用法；`unbind` / `binding` 已删除。

## Slash 命令

```
/datasets list [<id>/<set>]
/datasets show <id>/<set> [item]
```

`/datasets bind` 已退役：它现在回答一句去题集 tab「登记题库」（或 `dsh-datasets register`）的指引，不写任何东西。题库按部署登记一次，不再是会话级的动作。不带参数的 `list` 列出所有登记下的 `<id>/<set>`。

命令声明了 free-form input（`input.hint`）。这不是装饰：不声明的话，能力较强的 composer 没有理由认为 `/datasets` 收参数——从补全条选中命令会提交一个空参调用，人敲的 `show <dataset>` 留在消息体里，命令以 usage 行作答（T36 真机撞到的）。

## 题集 tab（web）

<!-- 截图占位：docs/screenshots/…-datasets-tab.png（待补） -->

web profile 下插件向会话的视图环贡献 **`datasets` tab**（标签「题集 / Datasets」，与 chat、trajectory 并列）。两页一壳，形状按 [web-eval 界面规格](../../profiles/web-eval/docs/ui-spec.md) §三 §四。

**槽位词汇**。文件按**谁看得到**标注，不按层名——层名是一个题集内部的作者约定，看 tab 的人要判断的是可见性。每个文件恰好落一个**角色**（由 `dataset.json` 的 `layers` + `register` 算出，是机制事实）：选手看得到（`modelFacing` 层）、只有判官（`grading`）、只有探针（`verify`）、不发给选手（其他敏感层）、所有人可读（透传区）。角色之上再给一个**槽位**显示名（题干 / 验收标准 / 参考答案 / 评估标准 / 检查脚本 / 其他文件），由基名启发式给出：`oracle/` 下的一律是参考答案，`task.md` 与 `prompts/` 下的是题干，`rubric*` 与 `standards-notes*` 是评估标准，`standards*` 是验收标准，`checks/` 与 `probes/` 下的是检查脚本，都不匹配时按角色兜底（verify 层归检查脚本，grading 层归评估标准）。协议的两种布局因此得到同一个答案：register 形态的 `answers/rubric.yml` 与约定形态的 `rubric.yml` 都是「评估标准 · 只有判官」。启发式与角色计算都在 `src/slots.ts` 一处，宿主与浏览器共用同一个函数——协议没有槽位字段，为一个显示名分叉 descriptor 格式不值得；题集自定义槽位名是后话。

**列表页**：一张表、一行表头——**仓库 · 题集 / 最新版本 / 题数 / agent 可见 / 用在哪些实验**；每个登记的仓库一条组行（登记 id、跟踪分支、有没有写入检出，以及编辑 / 移除），其下一行一个题集，题集名的 title 上是 agent 要用的引用 `<id>/<set>`。每一格回答的都是「agent 点这一行会拿到什么」：引用、「最新」此刻指向的 commit（跟踪分支的尖，不是检出的 HEAD）与它的日期、那个 commit 上有几道题、它能读到什么。「agent 可见」写人话：层名按 `src/client/vocab.ts` 的词表映射（`visible` 是题面，`grading` / `verify` 带答案），全是题面写「只看题面」，有一层带答案写「含答案」；词表外的层名原样显示，悬停说明它不在词表里、页面不猜它含不含答案；确切的层名一律在 title 上。这里只读：值旁边的「改」打开这个登记的编辑表单（已预填登记时选的层），表单仍是改可见层的唯一入口；详情页顶栏的可见层同样带「改」。「用在哪些实验」只写计数——「N 个实验 · 分布在 M 个版本」（版本 = 钉住的 commit；同一实验的几次 run 算一个实验；按题集 id 并在快照带登记 id 时按登记过滤），点一下展开实验名与各自钉的版本。窄面板（< 560px）表头收起，每行折成块。跟踪分支不存在的登记保留在列表上并带宿主的那一句原因（agent 的 `datasets_list` 直接跳过它）。页面上方的动作是**登记题库**（上面那张表单）与**从旧绑定登记**（一键合并旧绑定，悬空的标红跳过）；有写入检出的组上另有**新建题集**（`dataset.json` 骨架、`visible/prompts/`、`schemas/`、`items/`，写进写入检出）。列表整页是一个 `registry` RPC，加上每个登记一次不带题集的 `list`（只为「题数」；读不到或还没回来就是破折号，不写 0）；槽位对应、canary、`validate` 这些逐题集的投影在详情页经 `overview` 取。「用在哪些实验」一列取自 eval 插件的 Remote，**实例上没有 eval 就整列不渲染（连表头）**——一列破折号会承诺一个没装的功能。

**详情页**（题集 › 题目）：左边文件树，每个叶子带槽位与「谁看得到」（三种颜色：选手可见 / 不发给选手 / 不受保护），上方是槽位筛选 chip；右边打开一道题后，最上面是并排的两栏——**选手将看到**（这道题可见层的文件 + 题集级题干的清单与字节数，题集级的单独标注；答案键漂进可见层会先出现在这张表里，这就是它的用途）与**只有判官和探针看得到**（非 modelFacing 层里的文件，同一份层声明算出来的补集；栏底一行**可判性**：评估标准几条、各 kind 各几条、探针几个、题集级探针几个、阶段 schema 几个）；其下是**作答记录**（各实验里这道题的格子；eval 缺席时整区隐藏）、以及选中文件的预览。树上逐文件的彩色标签保留，作为次要信息。视图窄于 700px 时右栏整块移到树下方、整页一起滚动，右栏自身窄于 520px 时两栏上下排；顶栏按钮只整枚换行，按钮文字不折行。预览交给官方阅读器 primitives——markdown 经官方 `MarkdownText` 管线（与 chat 同一个渲染器），JSON 经官方 `JsonTree`，其余经 `CodeBlock`；本包没有任何自研渲染器。动作是**题目骨架**、**导入题目**、**validate**。

**写入都只进工作区，commit 仍是人的**（插件从不提交）。题目骨架按**这个题集自己的形状**落位：descriptor 的 `register` 已经为这个 item 说过话就落在注册路径上（`task.md` / `answers/rubric.yml` / `checks/probes/…`），没说过就走约定布局（`<层>/rubric.yml`）；已存在的文件一律不覆盖。占位的 `rubric.yml` 故意留空 `items: []`——`validate` 因此报 `RUBRIC_NO_ITEMS` 并指到那个文件，这是预期的下一步而不是缺陷。导入题目是**原样拷贝**一个已有题目目录，不重新归位任何文件：该题集的 `layers` 与 `register` 决定每个文件成为什么，落在层外的由 `validate` 如实报出。三个写动作都要求 operator 视图（tab 的按钮），agent 的起草路径仍是 `datasets_put_item`，只写登记的写入检出。

**错误态是三段式**（界面规格 §九）：一句人话说发生了什么（「登记的跟踪分支不存在」），一句说怎么修（能给命令就给命令），异常原文与绝对路径折在「详情」里——页面本身不渲染 `error.message`，也不裸露路径。原因从消息文本认出来（域内错误码过不了 Remote 线，到浏览器时只剩网关的三个传输码），所以 `tests/error-state.client.spec.tsx` 把宿主的真实句子喂给真实的分类器：改了宿主的措辞，测试先红，而不是用户先看到「说不清」。实验室 tab 用的是同一份实现的副本——客户端包不 import 兄弟插件（界面规格 §八）。

**视觉与文案按界面规格 §九 收口**（I5·T63，与实验室 tab 同一轮）。两个 tab 现在共用同一套写法：状态 chip（`Chip`）、空态（`EmptyState`）、区块、表格、「详情」折叠——各自一份逐字相同的副本，因为客户端包不 import 兄弟插件（§八）。落在这一页上的是：validate 结果与 canary 由带颜色的文字换成 chip，诊断 code 移到行的 `title`（页面上留句子）；「作答记录」里每个格子的**桶**与**阶段**走与实验室 tab 同一张状态词表（`src/client/vocab.ts`），不再是 `done` / `archived` 这样的英文标识；仓库分组头只显示登记 id，整条绝对路径在 `title` 上；几处空态（没登记 / 没有题集 / 筛选没命中 / 还没作答记录）各自带一句「下一步」和它自己的动作按钮，措辞与工具条上的那枚不同，免得读成同一枚按钮被复制了一遍。

**术语表 v2 与色彩语义**（I5·T63 补二）：界面规格 §九 的三条新增也落在这一页上。列头里的英文术语换成人话——canary → 防泄标记、validate → 校验；快照 → 题库版本；「作答记录」里每条记录写成「{对比组} · 第 N 次」，rep → 次数。色彩收到五档（绿 = 完成 / 成功、蓝 = 进行中、灰 = 未开始、红 = 失败 / 阻塞、橙 = 警告），与实验室 tab 同一份 `stageTone` / `bucketTone`：**「已归档 / 可释放 / 已释放」是灰不是绿**——跑到尽头是「结束了」不是「成功了」，绿留给「已判」。

**五档颜色真的落到 tokens 了**（I5·T67 补，走查 W3）：`stageTone` / `bucketTone` 选的 tone 一直是对的，painted 的却不是——`ok` 用了品牌蓝 `--dsw-alias-state-business-primary`，`busy` 用了正文色 `--dsw-alias-label-primary`，于是「完成」是蓝的、「进行中」是灰的。现在 `ok` → `--dsw-alias-state-success-primary`、`busy` → `--dsw-alias-state-business-primary`。两个 tab 的 chip 是**手抄的两份**（§八），所以两份一起改；eval 的 `tests/tones.spec.ts` 读**两份样式表**把这条钉住——chip 的颜色是样式表里的一个 token，jsdom 既不加载样式表也不算 computed style，客户端用例照不到它。

tab 的数据面是一个 Typert Remote 服务（`datasetsRemote`，线 namespace `datasets`），架在与工具同一个服务内核之上：`registry` / `previewRepo` / `register` / `updateRegistration` / `unregister` / `importBindings` / `list` / `show` / `read` / `readPassthrough` / `overview` / `itemBrief` / `validate` / `scaffoldDataset` / `scaffoldItem` / `importItem`。读取请求带登记 `id`（`repo`），宿主解析到仓库；读取方法是 operator 视图——白名单与 modelFacing 底线约束的是 agent 边界（工具 + 物化视图），不是看自己仓库的人；敏感层带「· 敏感」标记照常可读，真正没保护的透传区与 `item.json` 则显眼标出。唯一的例外是 `itemBrief` 背后那两次判定层读取：它们**显式指名单层**（`layers: ['grading']` / `['verify']`）而不是走 operator 旁路——页面要的是答案键的形状（几条、什么 kind），字节从不上线。浏览器半经官方 `ctx.remote.$mount` 通道挂载该 namespace；eval 的 namespace 在**每次调用时**用 `ctx.get` 探测，不在挂载时探一次——两个插件各自 `$mount`，谁先落地没有保证。

## Compatibility

- npm release 线（`@deepseek-ai/dsh@0.1.2-rc.1`）：✅——全部能力可用；所依赖的契约面（`ctx.tools`、`ctx.commands`、log-only session 事件、Typert Remote 通道、`conversation.view`）在该线上稳定。minHost 前移至 0.1.2-rc.1，旧宿主请停留在旧发布线。
- source 线（deepseek-harness master）：✅（verifiedHost: 0.1.2-rc.1）。
- 金丝雀校验与可判性校验都在本插件内部完成（只读 git 对象），不依赖任何新的宿主能力，两条线表现一致；`tools` 分组随模型工具面搬到伴生行 `@khorsheed/dsh-datasets-tool`（`read` / `authoring` / `all` / `none`），本行不再有这个配置键。
- 题库登记与只读物化（T73）同样是插件内部的：登记是状态根下一个 JSON 文件，物化只用 `git archive` + `tar`，不需要新的宿主能力，两条线表现一致；原生目录选择器沿用已有的宿主探测，探不到就只留路径输入。
- ⚠️ 降级（两条线相同）：slash 依赖交互式 UI adapter（web/TUI profile）；headless profile 下 `/datasets` 不可用，CLI 不受影响（模型工具由伴生行提供）。题集 tab 自隐：只有当当前会话的 preset 组合引用了 `@khorsheed/dsh-datasets-tool` 行时它才注册，判据取自官方 `pluginInventory` Remote，任何读不出的路径一律 fail-open（保持可见）。**「当前会话的 preset」沿父链取第一个**（I5·T60 · web-eval T39 · G13）：成员子会话自己没有 preset，单看它就失败开放，于是每个受判据管的 tab 都出现在选手的子会话里。发布顺序有约束：引用伴生行的 pack 必须先有伴生包被发布 / 安装——行解析失败只让该 preset 组合报 broken，实例 boot 不受影响。会话 tab 是 web 端面——TUI 没有 tab 机制；headless profile 提供 Remote 数据面但没有浏览器消费方。

本节与 package.json 的 `dsh.compat` 字段互为镜像，同步更新。

## Known Limitations and Deferred Work

- **descriptor 是 JSON 不是 YAML**——布局约定称之为 `dataset.yml`/`item.yml`，v1 读 `dataset.json`/`item.json`。可判性检查要读 rubric（题库侧写成 YAML，不是本包能改的形状），因而 `js-yaml` 自那时起在本包依赖链上；descriptor 继续读 JSON 是形状决定，不再是「没有解析器」。要让 descriptor 两者兼容只差一次自觉的改动，没人做是因为没人要。
- **item 元数据不按 `itemMetaSchema` 校验**——schema 仅声明、形状校验为对象并透传；对 item 元数据做完整 JSON-Schema 校验需要引入本包不接受的校验器依赖。
- **会话 tab 的预览经 RPC 读整个文件**——`read` 返回完整文件内容、无字节上限（与工具同语义）；超大层文件更适合走 `worktree_path` 消费。
- **金丝雀与可判性检查逐文件读内容**——`validate` 对每个可见层文本文件跑一次 `git show`（金丝雀），对每个带 rubric 的 item 再跑一到两次（rubric 与它的 `rubric.md`）；这是插件里仅有的两处读文件内容的校验，因此都只在 `validate` 上跑，`list`/`show` 的摘要警告仍然只有形状级的那条。
- **可判性检查认死 `grading` / `verify` 两个层名**——判定约定（作者协议 §6.7/§6.8）就是按这两个名字写的，编排器挂载的也是它们。层名本身在本插件里是自由的，所以一个把 rubric 放进别的层名的题库不会被检查（也不会误报）。把层名做成 descriptor 可声明的，是协议侧的改动，不在本包单方面能定的范围。
- **写进工作区的文件在提交前看不见**——树、`list`/`show`/`validate` 都从 HEAD 的 git 对象读，而 `put_item` 与 tab 的三个写动作都只写工作区。骨架刚落位时树上没有它、`validate` 也还不报它，提交之后才会出现；tab 在每个写表单和每次写入结果上都说了这一句。让读路径兼看工作区会让「快照」失去意义（一次 run 钉的是 commit），所以这是选择而不是疏漏。
- **物化缓存不自动回收**——每个 (仓库, commit, 题集, 层) 一个只读目录，跟踪分支每前进一次就可能多一份。要回收就删整个 `materialized/` 子树（目录是只读的，先 `chmod -R u+w`）；下次调用会按需重建。
- **T73 之前的托管 worktree 不在本包清理**——它们登记在题库仓库共享的 `.git` 里（并已加锁），清理是写共享状态，由人按 Agent Note `.agents/notes/` 里 T73 那条给的命令执行。
