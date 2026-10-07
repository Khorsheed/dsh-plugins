# Agent Note：datasets——添加题集改为「Agent 整理、人确认登记」

Status: implemented

## 问题

把一个数据集放进题集 tab，原来有两半接不上：

- 登记表单假定人手里已经有协议格式的 git 仓库，并且知道它的 commit 和分层；
- 大多数人手里只有一个 JSONL 目录、一份下载，或者一个公开基准的名字。

0.1 的办法是骨架表单（`SkeletonForm`）。它建一个空的协议目录，让人手工填。实际用下来，它会留下没提交的占位文件，也绕过了所有检查。没有任何环节把「原数据里有什么」和「登记的题集里有什么」对起来，丢了答案字段、有文件没用上，都不会被发现。

登记之后，「最新」跟随跟踪分支的末端。之后任何提交都会立刻到选手那里，包括改了 Agent 可见层的提交，没人先看过。

## 决定

这条路上有两个角色：负责转换的整理 Agent，和负责确认的人。四个决定划定两者的边界。

- **A——登记表只归人写。** 整理 Agent 的工具档（`src/tool-definition.ts` 里的 `organize`）是读工具加上唯一一个写工具 `datasets_propose_registration`。它把申请写到 datasets 状态目录下，从不碰 `registry.json`。登记只经由 `confirmProposal` / `confirmPending`（`src/remote.ts` 里的 Remote 方法）发生，由题集 tab 在人按下「确认登记」/「确认新版本」时调用。
- **B——整理是单独的会话。** 整理 Agent 会读到答案，所以它永远不是评测 Agent。「添加题集」弹窗（`src/client/AddDatasetDialog.tsx`）提供「让 Agent 整理」。这个操作用 `dataset-authoring` 预设（`Config.authoringPreset`）新开一个会话，把请求写进输入框但不发送。web-eval 的 presets 包在 `profiles/web-eval/presets/cordis.patch.yml` 里以 `preset-dataset-authoring` 一行提供这个预设。评测会话永远不继承它。
  - *T102（2026-10-06）起作废。* 上面的理由不成立：选手能看到什么由题集分层和编排器强制，与布置评测的 Agent 无关。题集整理并进评测模式，`dataset-authoring` 预设删除，「让 Agent 整理」新开的会话用授予了 datasets 工具行 `organize` 档的预设。仍是新开一个会话，只是不再用单独的预设。见 [T102 的 Agent Note](2026-10-06-t102-organizing-in-eval-mode.zh.md)。
- **C——新仓库默认放在 `$DSH_HOME/datasets/<名字>`**（`src/defaults.ts`；兜底 `~/.dsh/datasets`）。弹窗显示具体路径，开始之前不用先选位置。宿主的目录选择器可用时，弹窗的「更改…」可以为这一次请求另选父目录（[T95](2026-10-03-t95-add-dataset-directory-picker.zh.md)）。
- **D——人看到的是「版本 N · 更新时间」。** N 是所登记 commit 的提交数。commit 哈希、跟踪的 ref 和仓库路径放在评审页和详情页的「高级」里。

### 对照是核验过的，不是照抄的

每个申请都带一份对应关系（`src/proposal.ts`）：

- 原数据的每个文件或目录都有去向：拆分 / 原样复制 / 未使用 / 删除。拆分的记录还要列出每个字段的去向：要么有目标位置，要么写明丢弃理由；
- 输出里的每个路径模式都标明来源。

插件不照原样展示这份对应关系。它对照提议 commit 的 git 对象核验，原目录可读时也对照原目录。核验的内容包括：

- commit 是 ref 的末端；
- 工作区已全部提交；
- 每个输出文件都有解释；
- 每个源文件都有去向；
- 逐文件的记录数对得上；
- `validate` 通过；
- 不在任何层里、选手能看到的文件会被标出来。

问题会挡住确认。提醒放在对照上方的「登记前请看一眼」里。每条发现带 code 和 `params`，客户端用 `review.finding.<CODE>[.<kind>]` 的本地化 key 渲染，所以中文界面不会出现英文诊断。英文原文留作悬停提示和兜底。

评审页（`src/client/ReviewPage.tsx`）展示：

- 事实；
- Agent 的说明；
- 「原目录 → 题集」对照；
- 逐题下钻（逐条对照一题 / 随机抽看 3 题 / 完整清单），把原始记录和它变成的文件并排放；
- 按 Agent 建议预设好的分层开关；
- 登记名。

### 更新闸门

经申请确认的登记会记下 `confirmedCommit`（`src/registry.ts`）。只要自那以后的改动都落在 Agent 看不到的地方（未授权的层、`datasets/` 之外的文件；分类在 `src/zones.ts`），「最新」就继续跟随跟踪分支的末端。改动一旦落到 Agent 能看到的内容，「最新」就停在已确认的 commit，新版本以 `pending` 的形式出现。列表随之显示「新版本待确认」，人通过下面两者之一评审：

- 更新申请，如果 Agent 提交了申请；
- 合成的待确认评审，如果有人直接提交。这个评审用读者的语言说明这个版本没有整理申请。

确认后 `confirmedCommit` 前移。T90 之前的登记没有 `confirmedCommit`，行为不变。

更新评审的计数（新增 / 修改 / 删除 / 题集外）互不重叠：题集之外的文件只计入「题集外」。

### skill 怎么分发

转换流程写在 `packages/datasets/skills/dataset-authoring/SKILL.md`，列在包的 `files` 里。datasets 工具行以 `organize` 档运行时，把它注册进宿主的 `skills` 注册表（`src/tool.ts` 的 `loadAuthoringSkill`，`ctx.inject(['skills'])`）。它从不复制进 `$DSH_HOME/skills`，所以随包更新，并且只在授予了 organize 档的地方出现。`docs/dataset-authoring-protocol.md` 第 5 行指向它。

### 骨架表单删除了

`SkeletonForm` 已删除。首次添加和之后的修改现在走同一条路（整理、申请、确认），修改由更新闸门把关。`scaffoldDataset` / `scaffoldItem` 这两个 Remote 方法和对应的 CLI 子命令保留，供脚本和兼容使用。

### 整理预设与冻结决策 12

`dataset-authoring` 预设挂了 shell（`tool-bash` / `tool-pwsh`）、`tool-fs` 和 `tool-jobs`，因为整理要跑 git 和转换脚本。冻结决策 12 约束的是**评测** Agent（规划与分析）。`preset-eval` 一块字节不变，`scripts/web-eval-preset-bundle.spec.ts` 对它的钉住仍然成立。

*T102（2026-10-06）起作废：* 评测预设自己带 shell，冻结决策 12 改写——docker socket 仍只归编排器，但不再靠预设保证；防护看会话记录后再定。

## 考虑过的其他方案

**让整理 Agent 直接登记。** 少一步。代价是失去唯一一个让人在选手读到分层之前先看到选手会读哪些层的环节。刚读过答案的 Agent 不该做这个决定，所以 Agent 提申请、人确认（决定 A）。

**在评测会话里整理。** 不用新预设。但评测会话从此读过答案，可能把答案带进规划。这破坏了所有比较赖以成立的隔离（决定 B）。*T102（2026-10-06）最终采用了这个方案：* 选手隔离由题集分层和编排器保证，不靠规划 Agent 的上下文。

**照 Agent 写的对应关系直接展示。** 更简单。但评审就只和 Agent 一样诚实：一句幻觉出来的「6 条记录全部转换」和真的看起来一模一样。对照 git 对象和原目录核验之后，对照才成了证据。

**骨架表单与 Agent 路径并存。** 首次添加会有两条路。骨架那条跳过对应关系核验和确认，留下占位文件的也正是它。想手工做的人现在仍然可以自己做完再提申请。

**在顶层显示 commit 哈希。** 准确，但对做决定的人没有意义。「版本 N」能排出先后，又配着日期，哈希在「高级」里点一下就有（决定 D）。

**每个新提交都要确认，不管可不可见。** 更严。但每个 README 错字、每次看不到的判分调整都会变成一次确认，人会学会闭眼点过去。只拦 Agent 可见的改动，确认才保有意义。

**安装时把 skill 复制进 `$DSH_HOME/skills`。** 这样所有预设都能看到它，但它也会在卸载后残留，并和包版本脱节。从工具行注册，让它跟着 organize 档的授予走。

## 后果

- 题集登记背后现在一定有一个人确认过的 commit 和一份核验过的对应关系。代价是每个新题集都要一次需要模型的整理会话；手里已经有协议仓库的，仍可以直接登记（添加题集 → 高级 → 已经是题库仓库？直接登记）。
- 对已登记题集的 Agent 可见改动不会再悄悄到达选手。代价是列表多一个待确认状态，直接提交后要多一步确认。
- 申请的发现通过 code 和 params 本地化。新的发现 code 要配本地化 key，否则回落到英文。
- CSS modules 按文件给 `@container` 名字加作用域。评审页的窄屏布局起初查询的是 datasets 视图的容器，永远匹配不上，手机宽度下一直是两栏。`Organize.module.css` 现在声明自己的 `review-page` 容器，`tests/css-container.spec.ts` 会在任何模块查询自己没声明的容器时失败。
- 已知的噪声：更新模式下，一个没改动的不分层 README 仍会触发「选手可见」提醒；待确认评审里，`datasets/` 那一行输出显示为「新写」。
- 在临时的 0.2.0-rc.2 实例上验证时，用 RPC 和预置的申请把评审、更新、待确认三条流程走到了确认。需要模型的整理会话本身没有跑：没有凭据。
