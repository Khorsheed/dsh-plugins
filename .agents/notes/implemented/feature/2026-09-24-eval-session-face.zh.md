# Agent Note: eval —— 会话面：工具行实验卡、`eval_experiment_get`、标签计数的结论（T76 · D3）

Status: implemented

## Problem

agent 在会话里起草了一个实验，会话里留下的只是一行通用的工具调用：工具名、一段 JSON、两条绝对路径（`planPath` / `conditionPaths`）。人想知道起草了什么、现在怎样，只能自己切到实验室 tab 去找。agent 这边也一样零碎：要把一个实验读全，得拼三次读——`eval_cells` 不带 run id 找到它，`eval_run_status` 取状态词，再用 `eval_cells` 带 run id 读格子。到了分析里要引用某一份作答时，没有任何一个工具报文件名，agent 只能问人要路径。

## Decision

- **实验卡**：`eval_plan_draft` 的工具行挂在宿主的 keyed slot `tool.call.toolview` 上，键为 `eval_plan_draft`（`packages/eval/src/client/DraftCard.tsx`，数据部分在 `draft-card.ts`）。
  - 卡片显示：实验名、问题原文（rev14，有才出现）、规模、题库版本（`<登记>/<题集> @ 短哈希`）、状态。
  - 数据来自这次调用自己的块：settled 块的 `EvalDraftResult` 优先，参数兜底。唯一的活字段是状态，挂载时读一次 `remote.runs` 里对应的那一行；读不到就显示「草稿」，也就是起草动词本身留下的状态。
  - 两条绝对路径不进 `DraftCardModel`，从源头上保证不会显示。
  - 状态分四种：running（未返回）、failed（`isError`）、unreadable（结果里没有 experimentId）、ready。
- **一个动作「打开实验」，没有批准按钮**（R1）。
  - 宿主没有切会话标签的接口：`dsh.conversation` 的 `openView` 只注入给会话框架与标签头，工具行拿不到。所以按 T72 的结论回退：插件级的 `LabFocus` 通道（`createLabFocus`）按会话记下请求，实验室视图挂载或收到请求时把它取走。
  - 取走后的行为：回到列表并重读，把那一行标出来（`data-marked`，一圈主色细框——不用左侧竖线：行没有内边距，竖线会压在名字的第一个字上，第一次截图就是这样，并 `scrollIntoView`）。如果行不在「本会话」范围内，就切到「全部」，但不写范围偏好——那是人的选择，一次标记不该覆盖它。
  - 卡片下方提示「已在「实验室」标签的列表里标出这一行——切到那个标签就能看到」。
- **结构注册，不加依赖**：slot 由 `@deepseek-ai/dsh-client-ui-tool` 声明，但本包没有依赖它，pnpm store 里也没有它。
  - 注册写法是按结构 cast `ctx.slots`，再调 `slots.inject('tool.call.toolview', () => slots.register(...))`，遵守跨包 slot 注册约定。
  - `dsh.client.inject` 声明了 `@deepseek-ai/dsh-client-ui-tool`。
  - 组合里没有这个包时，工具行保持宿主的通用行。
  - 卡片不做 preset 自隐：这一行能出现，就说明会话已被授予 `eval_plan_draft`。
- **`eval_experiment_get({experiment})`**（`packages/eval/src/experiment-get.ts`，服务方法 `experimentGet`）。
  - 查找：按 experimentId、列表行 id 或 run id 找实验；都找不到时抛 `EvalReadRefused`。
  - 返回内容：
    - 列表那一行，去掉 plan 路径；
    - 全部 run id；
    - 最新 run 的摘要，与 `eval_run_status` 同源；
    - 桶计数；
    - 作答索引：每个 题×组×次 一条，含阶段、桶、检查点、注解条数、选手子会话，以及那次 attempt 登记的文件名。文件名相对 attempt 目录；账本里如果记了绝对路径，就收成相对名或 basename；
    - `analysis/` 里已有的文件名。
  - 所有字段都是实验室页已经展示的，所以两边数字一致是由构造保证的，不是靠另算一遍再核对。
  - 只读：不起跑、不 finalize、不 provision，也不碰人工评估出口。
  - 由 eval-tool 注册，eval-tool 的 README 分层表同步更新。
- **标签计数：不可行，不显示**。
  - `conversation.view` 的 `SlotLabel` 只在 ui-conversation 的 `refreshViews` 里重读，而 `refreshViews` 只在订阅 slot 或切换语言时触发。label 函数就算读的是活状态，标签也不会随状态重绘。
  - 另一条路是用 DOM 锚点改字，这违反「DOM 锚点是最后手段、要有兜底」的约定，而且标签节点不是公开契约。
- **S18 退路**：进度不回流会话，不做芯片、不发通知，agent 要看进度就读 `eval_run_status` / `eval_experiment_get`。rc.1 上看过三个候选，只记录，不接线：
  - `Session.append` 没有「模型忽略」的选项，写进去的每一条模型都会读到；
  - `agent.inject` 本身就是面向模型的，用它回流进度等于替人给 agent 发消息；
  - `shell.overlay` 是 root 作用域的，不属于某个会话，放会话进度会串到别的会话上。
- **验收用夹具**：真实的卡片需要一次真实的 `eval_plan_draft` 调用，而那需要配 provider，按规矩不配、不拷凭据。所以卡片由客户端测试（`tests/DraftCard.client.spec.tsx`、`tests/apply.client.spec.ts`）覆盖；截图用的是写进临时实例存储的一段夹具会话：真实宿主经由真实的 `tool.call.toolview` 键控槽渲染卡片，结果块的形状与真实结果一致，路径是 `/home/user/...`。手写 v3 会话日志要过四道校验，一道不满足整段历史都加载失败：每行一个 zstd 帧（头单独一帧）；`user/message` 要带 `source: {kind: 'user'}`；`assistant/message` 要带 `stream: []` 与 model 来源；会话要登记在 `storages/workspace.json` 对应工作区的 `sessionIds` 里才会出现在侧栏。宿主自带的 `packages/test-support/llm-mock-server` 能产生真实调用，这次没用，因为那也是在配 provider。

## Alternatives considered

- **在隐藏的标签里直接打开实验详情**：请求到达时让实验室视图直接进入设计页，人切过去时已经在那一页。未采用。人看不到的 tab 悄悄换了页，切过去时正在看的东西被替换掉；而且「打开」到了设计页，离批准按钮只差一步，却不在人的视线里。标出列表行只改一处视觉，人点进去是人自己的动作。
- **用 DOM 锚点给标签写计数**：未采用，理由见上。标签节点结构不是公开契约，宿主改一次就静默失效。
- **加 `@deepseek-ai/dsh-client-ui-tool` 依赖以拿到 `ToolCallOwnerProps` 类型**：未采用。它不在 store 里；把它加成依赖，eval 就与 ui-tool 的版本线绑在一起，而卡片只读块里六个字段。结构子集（`DraftToolBlock`）写明了读哪几个字段，宿主改形状时测试会先发现。
- **卡片自己拼一次 `eval_experiment_get`**：未采用。卡片只需要状态一个活字段，读列表那一行最便宜，也与实验室列表同源。

## Consequences

- `LabViewInjected` 新增可选字段 `focus`；手写 lab 注入面的测试不受影响。
- 工具卡片挂在 `@deepseek-ai/dsh-client-ui-tool` 声明的 slot 上。宿主如果改了 `ToolCallBlock` 的形状，卡片会落到 unreadable，只显示「这次调用的结果里读不出实验」，不会崩。
- 模型工具从六个变成七个（五读、一草、一扇分析的门），eval-tool 的提示词段与两份 README 已同步。界面规格 §六 的对应句子由协调者写回。
- 如果宿主以后提供了切标签接口，「打开实验」可以改成直达设计页，`LabFocus` 通道随之退役。
