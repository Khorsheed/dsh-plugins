# Agent Note: 题集 tab 的槽位、选手将看到、骨架与导入（I5 · T47）

Status: implemented

[English](2026-09-14-datasets-tab-slots.md) | 中文

## Problem

原来的 datasets tab 是「绑定条 + 一棵按层名展开的树 + 预览」。层名（`visible` / `verify` / `grading`）是**一个题集内部的作者约定**，而打开这个 tab 的人要判断的从来是另一件事：这份文件选手看不看得到。用户看不懂，是准确的反馈。

界面规格（[ui-spec](../../../../profiles/web-eval/docs/ui-spec.md) §三 §四）把形状定了：文件按「谁看得到」标注，槽位显示为题干 / 验收标准 / 参考答案 / 评估标准 / 检查脚本 / 其他文件；列表页一行一个题集；详情是树 + 预览 + 槽位筛选 + 「选手将看到」+ 可判性 + 作答记录；新建是骨架加导入，界面不做正文编辑器。

## Decision

- **角色是机制事实，槽位是显示名，两者分开算。** 每个文件按 `dataset.json` 的 `layers` + `register` 恰好落一个**角色**：选手看得到（`modelFacing` 层）、只有判官（`grading`）、只有探针（`verify`）、不发给选手（其他敏感层）、所有人可读（透传区）。这是层说了算的，显示启发式对它没有投票权。**槽位**再由基名启发式给出，匹配不上时按角色兜底。
- **两种布局必须得到同一个答案**，这是启发式的验收标准：register 形态的 `answers/rubric.yml`（item 相对）与约定形态的 `rubric.yml`（层相对）都得是「评估标准 · 只有判官」。一半答案来自路径，另一半来自角色兜底（verify 层归检查脚本、grading 层归评估标准）——`tests/slots.spec.ts` 里那张成对表就是钉这件事的，哪一侧改坏了都会以「这一对不再一致」暴露。
- **规则顺序是有意的**：`oracle/` 段最强、压过一切；`task.md` 与 `prompts/` 是题干；`rubric*` 与 `standards-notes*` 是评估标准——**必须排在** `standards*` 之前，否则判官的私有注解会被归进选手读的那个槽位。
- **启发式与角色计算写在 `src/slots.ts` 一处**，无 `node:`、无 yaml 依赖，宿主与浏览器 import 同一个函数。tab 与服务面因此不可能对「谁看得到这份文件」给出两种说法。为此把 `GRADING_LAYER` / `VERIFY_LAYER` 从 `rubric.ts` 挪进来（原处再导出，消费方不动）。
- **五个角色，三种颜色。** 读者的第一个问题是「选手看不看得到」，所以凡是不发给选手的共用一种颜色，角色那个词回答第二个问题。
- **列表页整页一个 RPC（`overview`）。** 槽位 ← 层要展开 register、`validate` 要读文件内容，这些都是宿主的活（ui-spec §八）；每个题集打三个 RPC 的列表页每次刷新的顺序都可能不一样。
- **canary 只报有无，永不带出串本身。** 它是泄题取证用的唯一串，进了 payload 就进了日志。
- **「用于的实验」在没有 eval 的实例上整列不渲染**，而不是渲染成一列破折号——后者承诺了一个没装的功能。同理，「作答记录」区在 eval 缺席时整区消失；eval 在场但答不出来时区**留着**，把 eval 自己的理由原样展示。这两件事必须分开表达。
- **`itemBrief` 背后那两次判定层读取显式指名单层**（`layers: ['grading']` / `['verify']`），不走 operator 旁路。页面要的是答案键的**形状**——几条、什么 kind——字节从不上线；这与编排器判官路径（eval `faces.ts`）是同一条纪律，而且比架构表允许的 operator 旁路更窄。
- **题目骨架按这个题集自己的形状落位。** descriptor 的 `register` 已经为这个 item 说过话，就落在注册路径上：精确模式原样用，同基名的精确模式次之，末位 `*` 的单层 glob 再次之——并且**优先选目录与约定路径自身目录相同的那个 glob**，于是 `probes/README.md` 落进 `checks/probes/*` 而不是 `checks/*`（在 `probes/` 段下才是探针，协议 §6.7）。register 没说过就走约定布局。猜错的后果不是难看，是把 rubric 落到层外——透传区，每个绑定会话都读得到。
- **占位的 `rubric.yml` 故意留空 `items: []`。** `validate` 因此报 `RUBRIC_NO_ITEMS` 并指到那个文件。这是预期的下一步，不是缺陷：骨架欠作者的只有「一个放对地方的文件 + 一具显然没写完的身体」。
- **已存在的文件一律不覆盖**（`putItem` 仍是 upsert，两者语义不同且都写在面上）。
- **导入题目是原样拷贝，不重新归位任何文件。** 该题集的 `layers` 与 `register` 决定每个文件成为什么；落在层外的由 `validate` 如实报出。按槽位猜着归位会在作者最需要知道真相的时候替他把问题藏起来。
- **三个写动作要求 operator 视图。** 新建题集的 id 按定义不可能在任何白名单里，与其为它发明一个例外，不如说清楚：这是 tab 的按钮（人的手势），agent 的起草路径仍是 `datasets_put_item`，受会话绑定约束。
- **eval 的 namespace 每次调用时用 `ctx.get` 探测**，不在 apply 时探一次。两个插件各自 `$mount`，谁先落地没有保证；一次性探测会在 eval 装着的实例上永久隐藏作答记录。
- **`/datasets` 补上 `input.hint`**（T36 真机撞到的）。不声明 free-form input，composer 没有理由认为这个命令收参数：从补全条选中会提交空参调用，人敲的 `bind <path>` 留在消息体里，命令以 usage 行作答。hint 的内容是文案，它的**存在**才是契约——测试钉的是后者。

## Alternatives considered

### 为什么不给 `dataset.json` 加一个槽位字段？

那是更准的路：作者说了算，不用猜。代价是为一个**显示名**分叉 descriptor 格式——协议要改、题库要改、eval 的读侧要跟、旧题集要迁移。而现有两个题库的命名已经足够规整，启发式一次也没猜错（`tests/slots.spec.ts` 的成对表覆盖了两种布局的七类文件）。「题集自定义槽位名」因此明确留作后话，不是遗漏。

### 为什么不让浏览器自己算字节数和 validate？

浏览器拿得到 `ItemRecord`（层 → 显示路径），算槽位绰绰有余——这也正是树上的标注在客户端算的原因。但字节数要读文件、`validate` 要读 rubric 与 canary、「槽位 ← 层」要展开 register。把这些搬到浏览器，要么逐文件打 RPC，要么把 git 读搬进客户端。投影算在宿主，tab 与 `datasets_*` 工具也就共用一份语义。

### 为什么骨架不顺手 commit？

因为这个插件从不提交（协议 §0），而这条不是洁癖：题集的快照是 commit，一次 run 钉的就是它。界面替人提交，就等于替人决定了哪一个字节集合叫「这一版题」。代价是**刚落位的骨架在树上看不见、`validate` 也还不报它**——读路径全走 HEAD 的 git 对象。这一句因此写进了每个写表单、每次写入结果、和两侧 README 的限制清单。

### 为什么不把「作答记录」在 eval 缺席时渲染成空区？

空区读起来是「这道题还没人做过」。那是一句关于**题**的陈述，而实情是一句关于**实例**的陈述：这台机器上没有编排器。两者会导向完全不同的下一步，所以缺席时整区消失、答不出来时留着并带上理由。

## Consequences

- `DatasetsRemoteService` 多六个动词：`overview`、`itemBrief`、`validate`、`scaffoldDataset`、`scaffoldItem`、`importItem`。既有七个一个字没动。
- `DatasetsService` 同名多五个方法；`createDatasetsService` 的返回值改成具名 const，好让 `overview` 复用 `validate`、`itemBrief` 复用 `read`（同一个内核，不复制第二份语义）。
- 三个新模块：`slots.ts`（纯，两侧共用）、`brief.ts`（列表行、选手将看到、可判性）、`scaffold.ts`（骨架内容与落位规则）。`rubric.ts` 的两个层名常量移入 `slots.ts` 并从原处再导出。
- 客户端拆成壳 + 两页：`DatasetsView.tsx`（取数与翻页）、`DatasetList.tsx`、`DatasetDetail.tsx`、`SkeletonForm.tsx`、`parts.tsx`（两页共用的词汇）。
- tab 标签从「数据集」改成「题集 / Datasets」；自隐规则（preset 里有没有 `@khorsheed/dsh-datasets-tool` 行）一个字没动。
- 实现期撞到一个 React 自取消：brief 的 effect 把 `briefs` / `briefLoading` 放进依赖，而它自己第一件事就是 `setBriefLoading(true)`——状态一变，effect 重跑、上一轮的 cleanup 把 `cancelled` 置真，刚发出的请求的答案被丢掉，面板永远停在加载。改用 ref 记「已请求过的 key」，把守卫挪出依赖表。同形状的 effect 值得照这个查一遍。
- T39 的端到端走查继承这两页；「题集自定义槽位名」与「列表页 validate 的开销」留作后话。

## Testing

- `packages/datasets`：167 个测试全绿（此前 148）。
- `tests/slots.spec.ts` 19 条：角色计算（含无敏感层的题集、透传）、五条路径规则与它们的顺序（`standards-notes` 必须先于 `standards`、`oracle/` 压过一切）、**两种布局的成对表**（七类文件各比一对槽位 / 角色 / 颜色）、兜底不把没挣来的槽位升给可见层文件、`slotLayerMap` 的透传保留名与顺序。
- `tests/scaffold.spec.ts` 12 条：落位的四条分支（精确、同基名、glob 填基名、glob 目录优先）、约定兜底、四个槽位的计划与「这个题集放不下这个槽位」的逐条理由、骨架 descriptor 逐层声明 `modelFacing`。
- `tests/remote.spec.ts` 增 10 条：`overview` 的槽位 ← 层 / canary 只报有无 / validate 单元格；`itemBrief` 在两种布局下列出同样三个文件、rubric 的形状被计数而正文从不上线、没有 grading 层时说清「不适用」而不是报零；`scaffoldDataset` 的落位与重名拒绝；`scaffoldItem` 在 register 题上只补那个缺的探针 README（且落在 `checks/probes/`）、在新题上走约定布局；**骨架后的 `validate` 在提交前后的差别**（工作区 vs HEAD，把上面那条限制钉住）；`importItem` 的原样拷贝与非目录拒绝；三个写动作在 agent scope 下被拒且什么都没写。
- `tests/DatasetsView.client.spec.tsx` 重写为 22 条：列表页逐格（含「一个 RPC」与透传区不显示成名为 `-` 的层）、无 eval 时整列消失 / 有 eval 时按题集过滤、详情树上六种槽位 · 角色标注、槽位筛选（断言限定在树里——「选手将看到」是题的投影不是筛选的）、选手将看到的字节与题集级标注且不含答案键、可判性逐 kind 计数、**作答记录的三态**（缺席隐藏 / 在场列出 / 在场但答不出时留区带理由）、预览与透传读取、三个写表单与 validate 的回显、以及绑定条原有行为。
- `tests/tool-groups.spec.ts` 增 1 条：`/datasets` 声明了 `input.hint`（T36 那个 bug 的回归）。
- `pnpm gate --all` 绿。
