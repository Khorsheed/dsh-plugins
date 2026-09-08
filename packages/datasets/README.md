# dsh-datasets

[English](README.en.md) | 中文

git 仓库之上的通用版本化数据集存储：分层 item、从 git 对象直读的 commit 钉版读取、整层消费的托管 sparse-checkout worktree 视图、以及在所有读取路径上强制层白名单的会话绑定。

本插件存在的理由是文件浏览器没有的三样东西：**语义契约**（descriptor 形状校验、层可见性类别、item 元数据 schema 声明）、**版本固化**（snapshot、git 对象直读、按 commit 去重的托管 worktree）、**访问治理**（会话绑定 + 机制化而非约定化的层白名单）。插件从不解释数据集的语义，也从不把内容复制出仓库。

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

两级规则纯粹按名字判定：顶层目录的名字若声明在 `layers` 清单里，它就是题集级层；其余任何顶层文件或目录都是 descriptor 透传，与之前一样置身 `list`/`show`/`read`/`worktree_path` 之外。`items` 是保留的 item 容器，不能用作层名。所有机制在两级统一生效：会话绑定的层白名单（列表过滤、读取拒绝、sparse-checkout 模式同时覆盖 `datasets/<id>/<layer>/` 与 `datasets/<id>/items/*/<layer>/`）、`modelFacing` 可见性类别（声明按层名，天然两级适用）。评测题集布局里，跨 item 共享且有可见性要求的内容就放在这里：`suites/<suite>/verify/helpers/` 放题集级层（判定时才挂载），评分 rubric 也从散落的顶层目录收进声明过的题集级层，白名单才真正管得到它们。

`modelFacing: false` 是数据声明，语义仅一条：该层离开本机的导出必须过人工确认闸（确认闸由导出方实现，不属本插件）。它与会话绑定的层白名单是两层独立机制——白名单管「会话里 agent 能看什么」，导出闸管「什么能离开本机」。

descriptor 还可带可选的 `register` 数组（数据集作者协议 §2）：把 item 目录内的自由文件显式注册进 item/层角色——`register: [{item, layer, files}]`，files 是 item 相对路径或单层 glob（`*` 不跨 `/`）。注册的文件在 list/show/树上归位到声明的层角色（物理位置与角色解耦），worktree 的 sparse 模式覆盖注册路径；路径越界、`**`、与布局形态冲突、精确路径不存在都会 fail loud。完整约定见根目录 `docs/dataset-authoring-protocol.md`。

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
| warn | `UNREGISTERED_FILES` | 未被任何层目录或 register 条目覆盖的文件——它们落在对每个绑定会话都可见的透传区 |
| warn | `CANARY_MISSING` | 声明了 `canary` 的数据集里，某个可见层的文本文件没有逐字带上它 |
| warn | `OBJECTIVE_NO_PROBE` | 该题有 `kind: objective` 的叶子，但 verify 层下没有可执行探针（`probes/` 段里的 `.mjs` / `.sh`）。探针是 objective 判定的唯一写入方，没有探针这些叶子就没人判 |
| warn | `RUBRIC_REF_DANGLING` | `rubric.md` 引用了 `rubric.yml` 没声明的叶子 id。id 形状按正则宽松匹配，故意容许误报（看着像 id 的表格标号），因此只报警告——而陈旧引用不是误报 |

`kind: llm-draft` 只要有叶子即视为有源：判官由 plan 提供，题库侧看不见它。`kind: human` 不查——判官台是人。plan 有没有给判官、plan 的 `expectedNs` 与题的判定源对不对得上，归 `dsh-eval validate`；本插件的检查止于题库。rubric 无叶子或读不出来时，后两条警告不再跑：那时每一条引用都必然悬空，噪声会把唯一要紧的那条 error 埋掉。

内容以仓库内普通文件的方式进入数据集，走正常 git 流程提交；或由 agent 经 `datasets_put_item` 起草进工作树、人评审后提交。没有 import 动词，也没有复制式物化：单文件从 git 对象直读，整层经托管 worktree 消费。

## 安装与加载

本包是 dsh 插件，唯一身份 **`@khorsheed/dsh-datasets`**，在 `dsh-plugins` monorepo（`packages/datasets`）开发并发布到 npm：

```sh
npm install @deepseek-ai/dsh                            # 宿主（dsh web / dsh CLI）
dsh plugin --profile web add @khorsheed/dsh-datasets    # 本插件
```

包声明了 `dsh.bundle`，add 会把它的 `cordis.patch.yml` 行（裸 `datasets` 挂载）调和进 profile 的 bundles 层——不需要手改 cordis.yml。一个 composition 只能挂载 `datasets` 行 id 一次；`dsh --profile web --dump-config | grep datasets` 无输出即说明可以安全 add。

配置（均可选）：`repo`（调用既无显式 `repo` 会话也无绑定时的默认数据集仓库；缺省无）、`worktreeRoot`（托管 worktree 根覆盖；缺省 `$DSH_HOME/state/datasets/worktrees`，否则 `<cwd>/.dsh-datasets/worktrees`）与 `tools`（注册哪一组模型工具；缺省 `all`，见[工具分组](#模型工具)）。

插件提供 `ctx.datasets` 服务供其他插件可选消费，注册 `datasets_*` 模型工具（哪些取决于 `tools` 分组，缺省八个全开）和 `/datasets` slash 命令，挂载 `datasetsRemote` Typert Remote 服务（web 会话 tab 的数据面），并（在 composition 挂载 `@khorsheed/dsh-datasets/invariant` 时）于加载期检查托管 worktree 根的结构完整性。

## 会话绑定

每个会话可绑定自己的数据集仓库，存为插件自管的持久化状态文件——插件状态根下每会话一条 JSON 记录（`$DSH_HOME/state/datasets/bindings/`，否则 `<cwd>/.dsh-datasets/bindings/`）：

```ts
{ repoPath: string, datasets?: string[], layers?: string[] }
```

`datasets` 限定可见的数据集 id；`layers` 是层白名单。缺省字段即「全部」。白名单在**所有**工具读取路径上强制——`list`/`show` 按它过滤，`read` 越界即拒，`worktree_path` 与它求交（交集为空即报错；sparse-checkout 让被拒层目录在 worktree 里物理不存在）。

**默认安全与边界对象**：绑定未显式写 `layers` 时，agent 的读取范围回退为该数据集的全部 `modelFacing:true` 层——敏感层要下发给 agent 必须显式列出；未声明敏感层的数据集行为不变（全部可见）。写路径（`put_item`）与 worktree 缺省跟随同一底线。白名单约束的对象是 **agent 工具与 worktree 物化**两条真边界；web tab 与 CLI 的读取动词是人的视图（operator scope），不受白名单与底线限制——敏感层对人照常展示并带「· 敏感」标记，树上另有「透传」分组把不受保护的内容显眼列出。

**为什么不是 session 事件**：初版把绑定存为 log-only `datasets/binding` session 事件，但 harness 的持久化读路径会拒绝重建「日志含有其生成的已知类型集之外的事件类型、且 envelope 未带 `ignorable: true`」的会话——下游（仓外）插件的事件类型按构造不在该集合内（注册面上游 deferred），而 `Session.append()` 无法设置该标记。本插件追加的任何自定义类型事件都会让会话在重启后不可读，因此绑定迁到插件自管存储（每次调用现读，所以 CLI 写存活会话的绑定也无竞争）。代价：fork 出的会话以未绑定开始；删除会话会留下一条孤儿记录。

绑定**写入**是人的操作：会话存活时用 `/datasets bind`、web tab 的绑定条，或脚本里的 `dsh-datasets bind`。agent 工具只解析绑定——agent 能用哪些数据由人决定。带显式 `repo` 参数的工具调用不依赖绑定（绑定存在时白名单仍然生效）；既无显式 repo 又无绑定又无配置默认时，工具明确报错并提示如何绑定。

白名单是会话级约束，不是安全边界：同机的人可改绑定，有 shell 的 agent 可读原仓库。它防的是误取和流程串味，不防恶意。

## 模型工具

| 工具 | 写? | 作用 |
|---|---|---|
| `datasets_list` | | 列绑定范围内的数据集，或某数据集的 item 及元数据 |
| `datasets_show` | | 数据集/item 详情：摘要、descriptor 透传、层文件清单 |
| `datasets_describe` | | 原样透传 `dataset.json` descriptor |
| `datasets_read` | | 读 item 某层某文件，从 pin commit 的 git 对象直读——无拷贝 |
| `datasets_snapshot` | | 固化 `{repoPath, commit, datasetId}`，仓库演进中读稳定版本 |
| `datasets_worktree_path` | 建托管 worktree | 整层只读视图路径（sparse-checkout 限层、按键去重） |
| `datasets_put_item` | 写工作树 | 创建/更新 item 元数据与层文件；`git commit` 留给人 |
| `datasets_validate` | | 作者卫生 + 可判性校验：形状错误与判不动的 rubric fail loud；六类警告（混合敏感度未表态层 / item.json 敏感字段名 / 未覆盖文件掉进透传区 / 声明了 canary 但可见层文本文件没埋 / objective 判据无探针源 / rubric.md 引用悬空），警告不阻断。逐条见上面的[规则表](#validate-规则表) |

**工具分组**：`tools` 配置决定注册哪一组工具——preset 挑不掉 profile 层已注册的工具，能决定的只有注册本身。四档是一条包含链：`read` = 六个读类动词（list / show / describe / read / snapshot / validate）；`authoring` = read + `put_item`（起草进工作树，提交仍然是人的）；`all`（缺省）= authoring + `worktree_path`（整层物化，会写托管 worktree）；`none` = 一个模型工具都不注册。系统提示词段只描述实际注册的工具，`none` 下连段都不贡献。服务、CLI、`/datasets` 与会话 tab 是人的面，任何档位都不动它们。**评测域建议 `authoring`**：规划期的 agent 要读题、要出题，但整层物化是编排器的动作，不该是 agent 能自己发起的一步。

`worktree_path` 返回托管根下的普通目录，以 (repo, commit, 排序后 layers) 为键、全机按键共享：`git worktree add --detach <commit>` + 限定层目录的 sparse-checkout + `git worktree lock`。消费方只读挂载或直接读取，绝不修改或删除——它是跨消费方缓存。同键并发创建由托管根下的锁目录串行化，后到者复用建好的 worktree。清理走 CLI 的 `worktree prune`。

## CLI

`dsh-datasets` bin 镜像工具的读取动词（同语义同名参数），另有维护动词。仓库解析：`--repo`，否则 `$DSH_DATASETS_REPO`。退出码：0 成功，1 操作失败，2 用法错误。

```sh
dsh-datasets list [--repo R] [--dataset D] [--commit C]
dsh-datasets show --dataset D [--item I]
dsh-datasets describe --dataset D
dsh-datasets read --dataset D --item I --layer L --path P [--commit C]
dsh-datasets snapshot --dataset D
dsh-datasets validate [--repo R] [--dataset D] [--commit C]
dsh-datasets worktree path --dataset D [--layers a,b] [--worktree-root DIR]
dsh-datasets worktree prune --repo R [--worktree-root DIR]
dsh-datasets bind --session ID --repo R [--datasets a,b] [--layers x,y] [--state-root DIR]
dsh-datasets unbind --session ID [--state-root DIR]
dsh-datasets binding --session ID [--state-root DIR]
```

`bind`/`unbind` 写插件自管的绑定存储（`--state-root` 缺省 `$DSH_HOME/state/datasets`；绑定在其 `bindings/` 子目录下）。存储每次调用现读，因此绑定一个运行中实例已打开的会话也无竞争——该会话的下一次工具调用即可看到新绑定。

## Slash 命令

```
/datasets list [dataset]
/datasets show <dataset> [item]
/datasets bind <repoPath> [--datasets a,b] [--layers x,y]
/datasets unbind
```

## 会话 tab（web）

<!-- 截图占位：docs/screenshots/…-datasets-tab.png（待补） -->

web profile 下插件向会话的视图环贡献 **`datasets` tab**（与 chat、trajectory 并列）——本会话数据集的绑定与浏览。tab 只做导航：顶部绑定条（当前绑定及其数据集/layers 白名单，加绑定 / 改白名单 / 解绑——绑定写入在这里同样只是人的操作，与 slash 路径一致），左侧数据集 →（共享层 →）item → 层 → 文件树（题集级层在 item 列表之前、归于一个安静的「共享」分组），右侧内容预览。预览交给官方阅读器 primitives——markdown 经官方 `MarkdownText` 管线渲染（与 chat 同一个渲染器），其余文件经官方 `CodeBlock` 语法高亮；本包没有任何自研渲染器。

tab 的数据面是一个 Typert Remote 服务（`datasetsRemote`，线 namespace `datasets`），架在与工具同一个服务内核之上：`binding` / `bind` / `unbind` / `previewRepo` / `list` / `show` / `read`。读取方法是 operator 视图——绑定只提供仓库路径，白名单与 modelFacing 底线约束的是 agent 边界（工具 + worktree），不是看自己仓库的人。树按角色渲染（register 注册的文件归位到声明的层），空层不显示，透传区单列成组（「透传 · N 个文件 · 不受白名单保护」），敏感层带「· 敏感」标记照常可读。浏览器半经官方 `ctx.remote.$mount` 通道挂载该 namespace。

## Compatibility

- npm release 线（`@deepseek-ai/dsh@0.1.0-rc.6+`）：✅——全部能力可用；所依赖的契约面（`ctx.tools`、`ctx.commands`、log-only session 事件、Typert Remote 通道、`conversation.view`）在该线上稳定。会话 tab 已在 rc.8 的 web profile 上做过活实例冒烟（绑定 → 树 → 预览）；更早的 release 线共享同一套网关约定，但未做冒烟。
- source 线（deepseek-harness master）：✅。
- `tools` 分组、金丝雀校验与可判性校验都在插件内部完成（第一项只是少调几次 `ctx.tools.register`，后两项只读 git 对象），不依赖任何新的宿主能力，两条线表现一致。
- ⚠️ 降级（两条线相同）：slash 依赖交互式 UI adapter（web/TUI profile）；headless profile 下 `/datasets` 不可用，模型工具与 CLI 不受影响。会话 tab 是 web 端面——TUI 没有 tab 机制；headless profile 提供 Remote 数据面但没有浏览器消费方。

本节与 package.json 的 `dsh.compat` 字段互为镜像，同步更新。

## Known Limitations and Deferred Work

- **descriptor 是 JSON 不是 YAML**——布局约定称之为 `dataset.yml`/`item.yml`，v1 读 `dataset.json`/`item.json`。可判性检查要读 rubric（题库侧写成 YAML，不是本包能改的形状），因而 `js-yaml` 自那时起在本包依赖链上；descriptor 继续读 JSON 是形状决定，不再是「没有解析器」。要让 descriptor 两者兼容只差一次自觉的改动，没人做是因为没人要。
- **item 元数据不按 `itemMetaSchema` 校验**——schema 仅声明、形状校验为对象并透传；对 item 元数据做完整 JSON-Schema 校验需要引入本包不接受的校验器依赖。
- **会话 tab 的预览经 RPC 读整个文件**——`read` 返回完整文件内容、无字节上限（与工具同语义）；超大层文件更适合走 `worktree_path` 消费。
- **fork 出的会话以未绑定开始**——绑定按会话 id 归档在插件自管存储里，不随 fork 继承；删除会话会留下其绑定记录（无害，一个小 JSON 文件）。
- **金丝雀与可判性检查逐文件读内容**——`validate` 对每个可见层文本文件跑一次 `git show`（金丝雀），对每个带 rubric 的 item 再跑一到两次（rubric 与它的 `rubric.md`）；这是插件里仅有的两处读文件内容的校验，因此都只在 `validate` 上跑，`list`/`show` 的摘要警告仍然只有形状级的那条。
- **可判性检查认死 `grading` / `verify` 两个层名**——判定约定（作者协议 §6.7/§6.8）就是按这两个名字写的，编排器挂载的也是它们。层名本身在本插件里是自由的，所以一个把 rubric 放进别的层名的题库不会被检查（也不会误报）。把层名做成 descriptor 可声明的，是协议侧的改动，不在本包单方面能定的范围。
- **被消费方写脏的 worktree 由 `worktree prune` 重建**——只读契约由消费方的挂载（`:ro`）强制，插件不强制。
- **`worktree prune` 需要 `--repo`**——注册表是 `git worktree list`，按仓库管理；已删除仓库残留的托管根手工清理。
