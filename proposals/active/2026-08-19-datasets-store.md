# 通用版本化数据集存储（datasets）

- **分类**：plugin
- **状态**：in-progress（M1 已交付，见实现记录）
- **最后更新**：2026-08-23
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived），无重复；本提案由 `datasets-mission` 合并提案拆出（姊妹提案：[通用任务管理 mission](2026-08-19-mission-tasks.md)；首个消费方：[受控实验单元 lab](2026-08-19-lab-experiment-units.md)）
- **官方依赖**：纯插件（所需契约均已实测存在：`ctx.commands`、`ctx.tools`、session log-only 自定义事件；内容即 git 仓库，无额外持久化依赖）

设计输入：`~/.dsh/scratch/dataseek-eval/README.md`（总纲）与 `~/.dsh/scratch/dataseek-eval/docs/tooling-brief.md`。已经过两轮设计评审；`worktree_path` 接口经 lab 提案的依赖分析后补入（2026-08-19）。**评审中变更（2026-08-23，评估 agent 提出，待评审通过后实施）**：`modelFacing: false` 参与读取控制——绑定未显式列层时敏感层默认不可读，见「会话绑定」节 ⚠ 标记处（已交付代码当前为「缺省全部」）。

## 目标

交付独立可插拔的社区插件 `@khorsheed/dsh-datasets`：git 仓库之上的**通用版本化数据集存储**。

- 数据集由若干 item 组成，item = 元数据 + 任意命名层的文件；提供列表 / 读取 / 快照固化（pin commit）/ 整层只读视图（worktree）/ item 撰写。插件**不解释**数据集描述文件的语义。
- **单一存储**：内容只住在 git 仓库里；单文件读取从 git 对象直接来，整层消费走**共享对象库的 worktree 视图**（按 commit+layers 去重）——两条路都不产生第二份内容拷贝。
- 每个会话可**绑定**自己的数据集（含 layers 白名单），供本会话 agent 使用；白名单在**所有**读取路径上生效（含 worktree）。
- **独立运作**：不依赖任何其他社区插件。**兼容**：mission（姊妹提案）可选消费 `ctx.datasets` 的 snapshot 引用与层可见性元数据；lab 经 `worktree_path` 消费整层视图；缺席时互不影响。

接口三面共用同一服务内核：模型工具（agent，第一公民）、CLI（脚本）、slash（人）；web 端一个会话 tab（M2 实现，预览复用官方阅读器）。零官方代码改动，`dsh plugin add/remove` 自由插拔。

**定位澄清**（「看起来像 Finder」之辨）：树导航与文件预览确实像 Finder——那是顺手面，渲染整个交给官方阅读器。本插件存在的理由是 Finder 没有的三样：**语义契约**（dataset.yml 形状校验、item 元数据 schema、层与 `modelFacing` 可见性类别）、**版本固化**（snapshot pin、git 对象直读、按 commit 去重的托管 worktree）、**访问治理**（会话绑定 + 层白名单在所有读取路径强制）。判死标准也立在这里：若这三样哪天被证明没有价值，本包就该退化成「直接用官方文件预览」，而不是继续往文件管理器方向加功能。

## 现状（官方契约实测）

- **模型工具**：`ctx.tools.register(defineTool({name, description, parameters, output, execute}))`（`@deepseek-ai/dsh-tools`）。参数用自带 DSL；`output: {schema, render}` 强制声明；注册返回 disposer 随 fiber 回收；写操作走标准 `tools/pre-execute` 审批管线；handler 经 `exec.agent` 拿调用方 agent/session；惯例配套 `ctx.systemPrompt.section` 引导段。工具名全局唯一，用 `datasets_*` 前缀。
- slash 命令：`ctx.commands.register(...)`（taskpilot 先例）。**执行入口是交互式 UI adapter（web/TUI）；headless profile 无 command adapter**。
- **session 自定义事件**：declaration merging 扩展 `SessionEventMap` 注册 log-only 事件（goal 的 `goal/change` 先例）——随 session 持久化、可审计，是「会话绑定」的存储形态。
- **会话 tab**：`conversation.view`（list slot，session scope），插件贡献完整 tab 有社区先例（ui-file-preview）。**注意：tab 环是 web 客户端的机制，TUI 没有**——TUI 里的呈现只有 slash 文本输出。
- 包骨架：host 半照抄 `packages/ankh-guard`；slash 写法抄 taskpilot；client 半（tab）参照 file-preview / ui-file-preview 对，浏览器 bundle 走 `clientBundle(id)`；v1 先实现 host 三面，tab 排 M2。

## 方案

### 数据模型

数据集仓库布局（目录结构是约定，层名任意）：

```
<repo>/
  datasets/<dataset-id>/
    dataset.yml            # id、name、layers 清单（含可见性类别）、item 元数据 schema；插件只校验形状
    <descriptor 任意其他文件>  # 原样透传（评测场景的 stages/rubric/schemas 都经此口出）
    items/<item-id>/
      item.yml             # 元数据（字段由 dataset.yml 的 schema 约束）
      <layer>/…            # 任意命名层
```

- 版本 = git commit；item 内容哈希 = 各层文件哈希（去重、追溯）。
- **层可见性类别是数据声明**：`dataset.yml` 的 layers 清单里每层可标 `modelFacing: false`（缺省 true）。语义两条：**①收录该层的导出必须过人工确认闸**（确认闸由导出方实现，见姊妹提案 mission §7）；**②（评审中）绑定未显式列层时，敏感层对该会话默认不可读**——见「会话绑定」节。与会话绑定白名单的关系：白名单是显式收窄，modelFacing 是缺省底线；导出闸管「什么能离开本机」。
- **数据进入方式 = 关联目录，不导入不复制**：datasets 只认「一个 git 仓库路径」（会话绑定的 `repoPath` 或 config 默认），内容 versioning 与哈希都来自 git 本身。已有内容进入数据集就两条路：人把文件按布局放进仓库并 commit（正常 git 流程）；或 agent 用 `put_item` 写工作树、人评审后 commit。插件没有、也不会有 import 动词。
- 读接口：`list` / `show`（元数据与文件清单）/ `describe`（descriptor 透传）/ `read`（**直接读 git 对象**——`git show <commit>:<path>`，单文件适用，不落拷贝）/ `snapshot`（固化 `{repoPath, commit, datasetId}`）/ `worktree_path`（整层只读视图，见下节）。
- 写接口：`put_item`（在工作树创建/更新 item 的元数据与层文件）。**git commit 留给人**——插件写工作树，提交与评审走正常 git 流程；这是「题库/内容包可持续产出」的支撑面。
- **没有复制式物化**：单文件走 `read`，整层走 `worktree_path`。逐文件 `git show` 拼装整层（几十个文件逐个 spawn git 进程）不作为接口提供；直接把仓库目录拷给调用方也不提供。

### worktree 整层视图（`worktree_path`）

lab 等消费方需要一次物化整个层（容器只读挂载的场景），逐文件 `read` 不可接受。由 datasets 创建并管理 worktree——仓库布局、commit↔层映射、worktree 注册都是 datasets 的内部知识，让消费方自己跑 `git` 等于把这套知识复制出去，两边一改就漂移。

- **签名**：`worktree_path({ snapshot, layers? }) → { path }`。⚠（评审中）layers 缺省语义收紧：**缺省 = 该数据集的全部 modelFacing:true 层**（敏感层需显式列出）；已交付代码当前缺省为全部层。
- **机制**：`git worktree add --detach <commit>` 到托管根 `$DSH_HOME/state/datasets/worktrees/<repoHash>/<commit>-<layersHash>/`，配 **sparse-checkout 限定到指定层目录**——白名单过滤是机制（worktree 里物理上只有允许的层），不是「返回根路径 + 口头约定」。**层白名单在此路径同等生效**：工具调用时 `layers` 与会话绑定白名单求交，交集为空即报错；CLI 调用（人/脚本，本就有等价 git 权限）取显式 `--layers`。
- **去重**：缓存键 = (repo, commit, 排序后 layers)。同 commit 同层组合全机共享一个 worktree。
- **生命周期归 datasets**：注册表即 `git worktree list`（git 自管，datasets 保持无状态）；worktree 一律 `git worktree lock` 防误 prune；清理走 CLI `datasets worktree prune`（解除 lock 并移除）。**消费方只读使用、只卸载不删除**——worktree 是跨消费方共享缓存（评测场景：同 commit 的所有格子共用），任何消费方的释放动作都不得删它。
- **产出就是普通目录，路径即接口**：worktree 路径与任何普通目录同形态（容器 `:ro` 挂载、脚本直读均无特殊机制），与「随便一个目录」的差别全是管理性的——commit 钉死、sparse-checkout 物理限层、托管去重。因此消费方（如 lab 的 `populate`）**无需代码级依赖 datasets**：它收一个目录路径即可，路径从 datasets 来还是调用方自供都行；白名单的强制点在「经 datasets 工具获取内容」那一刻，谁自供路径谁为内容担保。
- **并发**：同一缓存键的创建用托管根下的 flock 串行化。
- 残余边界（与绑定白名单同源）：有 Bash 的 agent 可直接读原仓库目录——白名单与 sparse-checkout 防**误取**不防**恶意**，风险节已声明，本路径不扩大该边界。

### 会话绑定

```ts
Binding = {                         // 存为 session log-only 事件（goal/change 先例），随会话持久化
  repoPath: string,
  datasets?: string[],              // 缺省 = 仓库内全部
  layers?: string[],                // layers 白名单；⚠（评审中）缺省 = 排除 modelFacing:false 层
}
```

- 工具解析：agent 调 `datasets_*` 工具时，handler 经 `exec.agent.session` 解析本会话绑定，**白名单外的层对工具不可见**（list/show/read/worktree_path 同受约束）——可见性分层从「操作约定」升级为「机制约束」，约束强度由绑定人决定。
- ⚠ **（评审中）机制级默认安全**：绑定未写 `layers` 时，读取范围回退为「全部 modelFacing:true 层」——敏感层要读必须显式列出（主动、清醒的动作）；忘了列的时候机制拦你。已声明敏感层的数据集才受影响；无敏感声明的通用数据集行为不变（全部可见）。已交付代码当前为「缺省全部」，实施时与绑定表单的默认勾选（默认只勾可见层）对齐。
- 绑定写入是人的操作（tab 按钮 / slash `/datasets bind` / CLI）；agent 工具只读解析，不能自改绑定——**agent 能用哪些数据由人决定**。
- 显式参数优先：工具调用带显式 `repo`/`dataset` 参数时不依赖绑定；无绑定时工具报错提示先绑定（fail loud，不静默猜）。

### 接口面

**模型工具**（`inject: ['commands', 'tools']`；`ctx.provide('datasets')` 供其他插件可选消费）：

| 工具 | 写? | 作用 |
|---|---|---|
| `datasets_list` | | 列绑定范围内数据集 / item 元数据 |
| `datasets_show` | | 数据集 / item 详情 + 文件清单 + descriptor 透传（白名单内层） |
| `datasets_read` | | 读 item 某层某文件内容（从 pin commit 的 git 对象直读，无拷贝） |
| `datasets_snapshot` | | 固化 `{repoPath, commit, datasetId}` |
| `datasets_worktree_path` | ✓（建托管 worktree） | 整层只读视图路径（sparse-checkout 限层，按 commit+layers 去重） |
| `datasets_put_item` | ✓（写工作树） | 创建/更新 item 元数据与层文件；git commit 留给人 |

CLI（`bin` 导出 `dsh-datasets`）与工具同语义同名参数，另有绑定写入、`worktree prune` 等维护操作。slash 薄封装：`/datasets list|show|bind`。

### 会话 tab（设计先行，实现排 M2）

`conversation.view` 注册 id `datasets`——本会话数据集的绑定与浏览。datasets 是**既有数据**（agent 的输入），与会话产物无关，UI 不做任何「产物式」呈现。**内容预览不自研渲染**：复用官方文件阅读/预览组件（产物与工作区文件同款的阅读体验，markdown 渲染、代码高亮都由官方件出），datasets tab 只负责树导航与把选中文件的内容交给它：

```
┌ datasets ──────────────────────────────────────────────────┐
│ 本会话绑定: dataseek-eval ▸ suites/harness-comparison        │
│             （layers: 全部）  [+ 绑定] [改白名单] [解绑]      │
│─────────────────────────────────────────────────────────────│
│ ▸ harness-comparison @a4f9c2e   8 items                     │
│ │  ▸ F1-edit-withdraw   难B   [message-tools, 改造]         │
│ │    meta.yml │ task.md │ standards.yml │ verify/(2) │ …    │
│─────────────────────────────────────────────────────────────│
│ 选中: F1-edit-withdraw / task.md                             │
│ ┌ 内容预览（官方阅读器渲染,git 对象 @a4f9c2e）──────────┐ │
│ │ …题面正文（markdown 渲染）…                           │ │
│ └───────────────────────────────────────────────────────┘ │
│ [引用进对话]                                                 │
└─────────────────────────────────────────────────────────────┘
```

数据面：host 半加 `TypertRemoteService`，gen-typert 出 remote artifact，client 半 `ctx.remote.$mount` 消费。

### Compatibility 标注（写进 README 与 `dsh.compat`）

- npm release line 与 source line 主体能力 ✅；
- ⚠️ 降级项（写 `notes`）：slash 依赖交互式 UI adapter，headless profile 无 command adapter——headless 下 slash 不可用；工具与 CLI 不受影响。会话 tab 属 web 端，仅 web profile 可见（TUI 无 tab 机制）。

## 评测场景用法（datasets 侧）

评测题集是 datasets 的一种用法（全流程见[姊妹提案](2026-08-19-mission-tasks.md)评测章）：

```
suites/harness-comparison/
  manifest.yml           # 阶段结构 + 表头 schema —— descriptor，插件不解释
  rubric/  shared/helpers/  schemas/
  tasks/F1-edit-withdraw/
    task.md  standards.yml   ← 给选手（lab populate：worktree_path 取 visible 层,只读挂载进容器）
    meta.yml
    verify/                  ← 判定时挂载（绝不复制进镜像）
    grading/ oracle/         ← 绝不出题库仓库（dataset.yml 标 modelFacing: false）
```

- 三级可见性 = 顶层目录名约定 + 会话绑定 layers 白名单（选手侧只绑 `visible` 等价层，worktree sparse-checkout 同受约束）+ 导出闸读 `modelFacing`。
- 题库可持续产出：agent 经 `put_item` 起草新题进工作树，人评审后 git commit。
- **runs 只进不出**：选手产出回题库（→oracle / →下一版起始状态）是 bench 的人工决策，留痕在 git；插件不提供也不阻止。

## 里程碑

- M1：仓库布局约定（含 layers 可见性类别）+ 会话绑定（session 事件）+ 服务/CLI/工具三面（list/show/describe/read/snapshot/worktree_path/put_item，git 对象直读 + sparse-checkout worktree，层白名单全路径强制）+ `worktree prune` + 单测
- M2（视姊妹提案断节实测决定先后）：datasets tab client 半（预览复用官方阅读器）+ Typert Remote 数据面

## 实现记录

- **M1 已交付**（2026-08-19，commit `d8cc48f`）：布局约定（JSON descriptor）+ 会话绑定（log-only session 事件）+ 服务/CLI/工具三面 + worktree 管理（sparse-checkout 限层、去重、lock/prune、flock）+ invariant；39 测试全绿。Agent Note：`.agents/notes/implemented/feature/2026-08-19-datasets-store-m1.md`（含偏离说明：JSON descriptor、CLI bind 离线写日志、put_item 白名单收紧）。待办：活 profile 的 `dsh plugin add` 冒烟（验收 1、2 的实例部分）。

## 验收标准（done 判定）

1. `dsh plugin add` 可装、`remove` 可卸，零官方改动；不装 mission / lab 时全部能力可用。
2. **agent 工具实测**：会话中 agent 仅用模型工具完成「bind → list/show → snapshot → read → worktree_path → put_item」回路；**层白名单实测**（绑定只含 `visible` 等价层的会话，工具取其他层被拒；**worktree 内物理不含白名单外层目录**——sparse-checkout 生效）；⚠（评审中）**默认拒绝实测**（绑定未列层时取 `modelFacing:false` 层被拒，显式列出后放行）；`datasets_read` 不产生仓库外拷贝；工具卸载随 fiber 回收。
3. **worktree 实测**：同 (commit, layers) 两次调用返回同一路径（去重）；pin commit 后仓库继续演进，worktree 内容仍是 pin 版本；`prune` 只清理解锁后的 worktree；并发同键创建不产生两个目录。
4. 绑定持久化实测：binding 随 session 重启后仍在（session 事件）；无绑定时工具 fail loud。
5. **通用性 grep**：源码不硬编码任何层名、无逐文件 spawn git 的拼装式物化、不出现评测词汇。
6. `pnpm run build && pnpm run test` 绿；双语 README + Compatibility 段 + `dsh.compat` 同步。

## 风险 / 放弃的东西

- **绑定白名单是会话级约束，不是安全边界**：同机人可改绑定、有 Bash 的 agent 可读原仓库目录；白名单与 sparse-checkout 防的是 agent 误取/流程串味，不防恶意操作者。
- **（评审中变更的行为面）**：「缺省排除敏感层」是机制级收紧——已声明 `modelFacing:false` 的数据集上，缺省绑定的可见范围变小（这是目的）；无敏感声明的数据集完全不变。已交付代码与旧行为的迁移注意点：绑定表单「改白名单」的呈现要区分「缺省（机制底线）」与「显式收窄」。
- **worktree 是共享只读缓存**：消费方写入会污染其他消费方的视图——契约只读（容器场景由消费方以 `:ro` 挂载强制）；发现被写脏的 worktree 由 `prune` 重建。消费方释放时只卸载不删除。
- **写工具的风险面**：`put_item` 依赖 harness 标准审批管线约束；只写工作树不做 git commit，提交评审留在人的 git 流程里。
- **数据集仓库不发布**：发布的只是通用插件；题库/内容包数据保持私有。
- **headless profile slash 不可用**：harness 现状，降级项如实标注；工具与 CLI 不受影响。
