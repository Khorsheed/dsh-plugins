# Agent Note：eval——新建实验改为「填必要项、让 Agent 组织」；实验室与题集空白状态

Status: implemented

## 问题

新建实验向导（I5·T67）分四步问问题：commit 哈希、种子、容器镜像等。多数人只是想说「比一下这两个」，大部分答案并不知道。而且这些问题用表单来问，规划 agent 其实已经会在对话里一项一项把它们定下来。

两个空白状态也帮不上忙：

- 实验室列表空着，没有下一步可做；
- 题集 tab 没说「登记」是什么，导入按钮用的还是内部用词。

## 决定

**弹窗**（`packages/eval/src/client/NewExperimentDialog.tsx`，纯函数在 `organize.ts`）有四个字段：

- 名称，唯一的必填项；
- 问题；
- 题集；
- 题目，选了题集才出现。

**名称**边输边校验，规则就是 `eval_plan_draft` 自己的（`^[a-z0-9][a-z0-9._-]*$`，不区分大小写）。报错会点名不合法的字符。

**唯一的动作**「让 Agent 组织」拼出一段结构化请求，分四部分：

1. 已定好的；
2. 还没定的，编号列出，按提问顺序：问题、题集、题目，然后固定是对比组、判官、次数、预算；
3. 「后四项请给出缺省建议，让我确认」；
4. 「用 `eval_plan_draft` 起草，不要启动」。

这段请求经 `insertDraft` 放进本会话的对话框并聚焦，从不代发。没有对话框时写到剪贴板，两种情况都有提示。

**占位题**默认隐藏，点「显示 N 个占位题」才出现。

- 依据是题集自己的 `item.json`：`taxonomy.category === 'fixture'`，或者带 `fixture` / `placeholder` 标签。
- 只有读不到 `item.json` 时，才退回看 id：`/^P0-/` 或 `/placeholder/i`。
- 这就是 `src/draft.ts` 里的 `isPlaceholderItem`。
- `draftOptions` 在原有的 `items` 旁边新增 `itemInfo`（标题、阶段数、是否占位）。没有它的宿主照样列出 id。

**向导的客户端代码直接删掉**，没有留成不可达的死代码。删掉的有 `draftExperiment` 客户端调用及其 CSS，外加 51 个死掉的文案键。服务端动词 `newExperiment` 和 `draftOptions` 保留：前者给 agent 用，后者给弹窗供数据。

**「添加对比组」**原先打开向导的分组步骤，现在同样交给 agent：把一句请求（`design.addGroupAsk`）放进对话框，不代发。

**引导。** `eval-planning` SKILL 新增「When the form hands it over」一节，preset 里加了对应的一句：请求来自表单时，带着缺省建议逐项问完还没定的，最后起草出草稿。

**空白状态。** 两处都用同一个居中的页面级 `EmptyState`：一个图标，一句话说明这页是干什么的，再给出下一步。

- **实验室：**「可以在这里填个名字交给 agent，也可以直接在对话里说想比什么。」
- **实验室筛到「本会话发起」后为空**（别的会话有实验）：同一块居中区域、同一个图标，文案是「本会话还没有实验」，并指出其他会话的实验在「全部」里。之前它是一行靠左的小字，看起来像另一种页面。
- **题集：**空的时候隐藏计数标题和工具栏按钮。主按钮是「登记仓库」，次要链接是「导入以前在会话里绑定的题库」。

## 考虑过的其他方案

- **把向导砍成更少的步骤。** 否决：剩下的每一步仍是在表单里回答 agent 在对话里能定得更好的事，而且两条通往同一份草稿的路得一直保持一致。
- **自动发送请求。** 按派发要求否决：点一下就花 token，还拿掉了用户发送前的最后一眼。沿用 T84 的 `insertDraft`，从不代发。
- **只凭 id 规律认占位题。** 不作为主规则：题集已经在 `item.json` 里写明了哪些是 fixture，而 id 约定只是某一个仓库的习惯。id 只做兜底。
- **从 `schema.ts` 导入名称规则。** 否决：那是宿主侧代码，会把 plan schema 拉进浏览器包。`organize.ts` 留一份副本，由测试钉住两者一致。

## 影响

- 请求里故意不写题集版本：`eval_plan_draft` 会自己定，有歧义时才问。
- `ui-spec.md` 改为描述新弹窗和空白状态，向导那段删掉了。
- **构建说明。** 本检出的 main 跟踪宿主 0.2.0-rc.2（`2026-09-29-host-020-rc2-adaptation.md`）。
  - 四包 build/test 用冻结的 `~/code/deepseek-harness-0.1.7-rc.1`，typert 限定在 eval 和 datasets（`GEN_TYPERT_ONLY`）。全量构建时 capture 和 file-preview 的 typert 在这个 harness 上会失败，这是本任务之前就有的问题。
  - 临时实例的安装（`web-eval install.sh --source`）需要 `DSH_HARNESS=~/code/deepseek-harness-0.2.0`，源码不动。实例本身仍跑在 0.1.5 工具链上。
- **既有失败。** `scripts/generate-package-map.spec.ts`（"matches the committed docs/packages.md"）在基线 70648d48 上同样失败，与本改动无关。

## 测试

- `organize.spec.ts`：
  - 请求在字段有选、没选两种情况下的内容，以及提问顺序；
  - 名称校验：空、非法字符、开头不对；
  - 占位题过滤。
- `NewExperiment.client.spec.tsx`：弹窗端到端，包括「放进对话框 → 聚焦」和剪贴板兜底两条路径。
- `draft.spec.ts`：`isPlaceholderItem` 分别按元数据和按 id 兜底判断。
- datasets `DatasetsView.client.spec.tsx`：空白状态下恰好一个登记按钮、一个导入按钮。
- 在 0.1.5 线临时实例上截图，覆盖弹窗各场景和两个空白状态，每个场景 1440 宽、400 宽各一张。
- 只填名称的真实一轮：请求按弹窗生成的原文逐字节发出，发在临时实例上新开的评测模式会话里。这一轮停在 `MISSING_CREDENTIAL`：临时实例没有模型 provider，本任务既不配置 provider，也不复制凭据。逐项引导这一项尚未验证，已报协调者。
