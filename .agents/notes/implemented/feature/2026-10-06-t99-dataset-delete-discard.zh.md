# Agent Note: datasets 与 eval——删除题集、放弃整理结果、实验列表扛得住坏目录

Status: implemented

## Problem

题集 tab 原来只能撤回登记。「移除登记」调用 Remote 的 `unregister`，只删登记，仓库还留在磁盘上。想把一个题集真正删掉，页面里没有办法。Agent 整理好的仓库（T90 的 proposal，挂在横幅「Agent 整理好了「…」，等你确认登记」上）也只能确认，不能扔。

同一次走查里，实验室列表上方挂着四行英文原文 `no experiment "<id>" in this deployment`。那个实例的 `DSH_HOME` 放在系统临时目录下，临时目录清理删掉了文件，只剩空目录。`listExperimentRecords` 把每个这样的目录记进 `problems`，实验室把宿主的句子原样显示出来。

另外，「agent 可见」列的每串层名后面常驻一个灰字「改」。它和行上的「编辑登记」功能重复，看着像噪音。

## Decision

### 一个「删除」，一个确认框，两种结果

每个登记行只有一个「删除」（`registry.remove`），原来两步点击的移除去掉了。点击后打开一个确认框（`src/client/RemoveDialogs.tsx` 的 `DeleteDialog`）。确认框先问宿主删除会做什么（`deletePlan`），然后显示：

- 会删的目录，用等宽字体；
- 一并清掉几处插件状态；
- 用过这个登记的实验，列实验名（同一实验的多次运行合并），并写明「这些实验的历史记录保留，但不能再跑」。数据和「用在哪些实验」那一列同源（`datasetExperiments`，每次调用时探测 eval 的 namespace）。datasets 不 import eval；没有 eval 时这一块直接不出现；
- 「删除后无法撤销」。

底栏把两种结果分开。危险色的「删除」把登记和文件一起删掉（`deleteRegistration`）。ghost 样式的「只移除登记」只删登记，文件保留（沿用原来的 `unregister`）。正文里两种结果也各写一行，人先读到选择，再看到按钮。

宿主的计划说文件要保留时，确认框换一种形式。这些情况会触发：仓库在 datasets home 之外、路径上有软链、不是仓库根、有别的检出、目录已经不在。标题变成「移除登记「id」」，正文以「文件留在原处」开头写明原因，唯一的操作是「移除登记」。没有删除按钮，也就不会看错。

调用被拒或失败时，确认框保持打开并显示消息（`role="alert"`）。成功后刷新登记和 proposal 列表。

### 路径规则（宿主侧，`src/removal.ts`）

浏览器只用 **id** 指明一个登记或一个 proposal。目录在宿主上从记录里的 git common dir 推出来：`<root>/.git` 对应 `<root>`，裸仓库就是它自己的目录。请求里夹带的 `path` 字段会被忽略。下面每条规则都成立才删目录；否则计划是 `keep`，并带上 `keepReason`：

1. **`outside-home`**：目录必须**严格**位于 datasets home（`organizing.datasetsHome`，默认 `$DSH_HOME/datasets`）的 realpath 之内。home 本身永远不会被删。
2. **`missing`**：目录已经不在了。
3. **`symlink`**：从 home 往下到目录的每一级都不能是软链，目录的 realpath 也必须等于它自己。
4. **`not-repo-root`**：
   - 工作树的 `.git` 必须是真目录，不能是链接，也不能是 gitfile；
   - 在该目录里问 git，回答的 common dir 必须相同；
   - 对工作树，git 报出的 toplevel 必须正是这个目录。仓库里的子目录、或者另一个仓库，都会被拒绝。
5. **`other-checkouts`**：`git worktree list` 里不能有位于目录之外、仍然存在的检出。本插件 state 根下的旧托管 worktree（`<stateRoot>/worktrees`）不算「别的检出」，而是计入插件状态。
6. 物化视图 `<stateRoot>/materialized/<repoKey>` 存在且不是链接时，计入插件状态。

删除那一刻会重新算一遍计划。计划是 `keep` 时，`deleteRegistration` 抛 `NOT_REMOVABLE`。删除分三步：

- 先在 home 内把目录原子地 rename 成隐藏的兄弟目录（`.removing-<name>-<pid>-<ts>`）；
- 再删登记，同仓库还没处理完的 proposal 也一起删掉；
- 最后用 `removeReadOnlyTree` 删掉改名后的目录树和插件状态。`removeReadOnlyTree` 遇到链接只删链接本身，不进去遍历。

rename 之后出错，只会留下一个隐藏的残留目录，不会出现「删了一半却还登记着」的仓库。

### 待登记横幅上的「放弃」

待登记横幅在「核对并登记」旁边加了一个 ghost 样式的「放弃」。`DiscardDialog` 显示目录，并说明整理会话保留，然后调用 `discardProposal`。这个调用要求 proposal 处于 pending 或 returned 状态，删掉 proposal 记录，并按同一套规则删掉整理出的仓库。放弃还多一种保留原因：**`registered`**，即 proposal 是一次更新，或者它的仓库已经登记过。放弃永远不会删掉已登记的仓库。仓库删掉时，同仓库其他未处理的 proposal 一并删掉。整理会话、它的记录、会话下的 worktree 都不碰。

### 实验列表容错（eval）

`listExperimentRecords` 分两种情况处理读不出 meta 的目录：

- 目录里只有（层层嵌套的）空目录：静默跳过，里面没有可找回的东西。
- 目录里有内容：报成 `{id, message}`。软链、任何别的条目、读不出来的子目录，都算有内容。

`listExperiments` 在原有的 `notes` 旁边多返回结构化的 `notices`（`{code, params, text, items?}`，即 T98 判定说明的形状）。`notes` 不变，仍是这些 notice 的文本，留给只读文本的使用方。所有读不出来的目录合成一条 `experiments-unreadable` notice，带 `{count}`，目录名放在 `items` 里。实验室把它显示成一行「有 N 个实验目录读不出来」，展开可以看到目录名。

实验室对认识的 code 用自己的语言措辞，不认识的回退到宿主文本。宿主较旧、不返回 `notices` 时，显示原来的 notes。列表上方其余的 notice 也按 code 本地化：

| code | 触发条件 |
|---|---|
| `plan-unreadable` | `{id, detail}` |
| `mission-missing` | 没有 mission 服务 |
| `mission-cannot-list` | mission 服务列不出运行 |
| `mission-list-failed` | `{detail}` |
| `state-root-missing` | DSH_HOME 未设置 |

### 悬停铅笔

`LayersEdit`（`src/client/parts.tsx`）改成图标按钮：用 ui-primitives 图稿里的 `IconEditOutlineMedium`，重新生成进本包的 `icons.tsx`。`title` 和 `aria-label` 都是 `layers.editTitle`。

- 表格里（`variant="row"`）平时透明，行被悬停或键盘焦点进入时才显示。
- `@media (hover: none)` 下，以及容器宽度不超过 560px 时，常显。
- 详情页的标题栏（`variant="bar"`）常显，因为那里没有行可以悬停。

同一张表里其他常驻的小操作，按同一规则检查过：

- **用量开关（「用在哪些实验」的数字）。** 保持常显。它首先是数据，按钮只是附带的。
- **「待确认」标记。** 保持常显，它是状态。
- **仓库组上的操作（「交给 Agent 修改」「编辑登记」「删除」）。** 保持常显。它们挂在仓库组的组头上，不在题集行里，是这个仓库的主要操作。藏起来就找不到发起这些流程的入口了。
- **其余。** 题集行里没有别的常驻行内操作。

## Alternatives considered

**行上放两个按钮，「删除」挨着「移除登记」。** 任务允许这样做。没选它的原因：行上已经有三个按钮，两个都叫「移除/删除」的按钮一眼看过去分不清。放进一个确认框，两种结果并排、各自写明后果，而且由宿主决定提供哪几种。外部仓库根本不会出现删除按钮。

**信任客户端传来的路径，在宿主上校验。** 浏览器传来的路径本来就得和记录核对。直接从记录推出路径，既没东西要校验，也没东西可伪造。

**原地 `rm -rf`。** 删到一半崩溃，会留下一个还登记着、文件却少了一半的仓库。先改名再删除，页面看到的状态是原子变化的。

**home 里遇到软链就跟到真实目标。** 指进 home 的链接可能指向任何地方，比如某人自己的检出。路径上见链接就拒，是唯一能保证永远不删到 home 之外的规则。

**「放弃」时连整理会话的 worktree 一起删。** 任务要求会话不动，而且人要在会话里看 agent 做了什么。那些文件属于会话，不属于题集。

**读不出来的实验目录全部隐藏。** 空目录是噪音，但有内容的目录里可能有人的工作。折起来列出目录名，列表干净，也不会悄悄丢东西。

**用 `notices` 取代 `notes`。** 只读文本的使用方和旧浏览器读的是 `notes`，所以两者都返回。`notices` 在类型上是可选的，旧宿主照样能通过类型检查。

## Consequences

- 题集可以在页面里删除了。外部仓库仍然只能撤登记，确认框会写明这一点。
- 删除按设计不可撤销。确认框写明这一点，并列出会因此跑不了的实验。这些实验的历史仍然能看。
- 新增 Remote 动词 `deletePlan` / `deleteRegistration` / `discardPlan` / `discardProposal`，新增错误码 `NOT_REMOVABLE`。
- 仍是英文、但不在实验列表上方的说明：`runsForItem` 的 notes（题目作答记录）、草稿选项的 notes（`draft.ts`，显示在设计页）、题目材料的 notes。它们不在 T99 范围内。
- 全仓的图标同步脚本（`scripts/sync-icon-artwork.mts`）在现有两条宿主线上都跑不通：每条线都缺另一条线有的一个图稿。这次只用 0.1.7-rc.1 的图稿重新生成了 datasets 的 `icons.tsx`。

## Testing

- `packages/datasets/tests/removal.spec.ts` 全部在 `mkdtemp` 临时目录里操作，覆盖：
  - home 内的仓库连同物化状态一起删除；
  - home 外的仓库只撤登记；
  - 指进 home 的链接，以及路径上有软链的目录；
  - home 本身，以及不是仓库根的路径；
  - 目录之外有检出；
  - 删除计划里带上实验所钉的题集（`sets`）；
  - 未知 id，以及请求里夹带的客户端路径；
  - 放弃：新仓库被删除，外部仓库文件保留，已登记仓库永远不删，已确认的 proposal 拒绝放弃。
- `packages/datasets/tests/DatasetsView.client.spec.tsx` 覆盖：
  - 删除确认框：列出实验的情况、只撤登记的路径、外部路径的保留形式；
  - 被拒的删除；
  - 「放弃」横幅和两种放弃形式；
  - 铅笔的 aria-label，以及 row/bar 两种变体。
- `packages/eval/tests/experiment-store.spec.ts` 和 `experiments.spec.ts` 覆盖：被清空的目录与坏目录的区分、折叠的 notice、各个 code。
- `packages/eval/tests/LabView.client.spec.tsx` 覆盖：折叠、按 code 出句子、未知 code 的回退。
