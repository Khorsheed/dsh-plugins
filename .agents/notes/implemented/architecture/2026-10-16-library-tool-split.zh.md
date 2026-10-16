# Agent Note: 图书馆 —— 每个名词一个工具（模型面拆分）

Status: implemented

## Problem

模型面原来是三个动词 + `what` 枚举，`library_write` 扛着所有写操作的载荷并集：14.6 KB 的描述 + schema（占图书馆工具预算的 76%）。`title`/`toc`/`tocSource` 永远没法做 schema 级必填——它们只对 `what=book` 生效——于是缺字段只能变成运行时教学，而不是 schema 错误；每次调用都要模型在九个操作的并集里挑对字段子集。实盘会话付出了代价（建项那场的「满屏报错」）。

## Decision

把写动词拆成每个名词一个工具——`library_project`、`library_book`、`library_resource`、`library_roadmap`、`library_notes`、`library_page`、`library_cards`、`library_quiz`、`library_binding`——`library_read`（只读分发无害）与 `library_assess` 不动。每个写工具：

- 在 schema 线声明自己的必填字段（`library_book` 必填 `title` / `bookKind` / `toc`；`library_roadmap` 必填 `nodes`……）——dsh-tools 的 DSL 把字段级 `required: true` 编译进父 schema 的 `required` 数组，且与 `oneOf` 组合无碍（JSON 文本传输分支保留）；
- 保留实盘证明过的传输容错（大载荷的 JSON 文本、`chapterRanges` 语法糖、cover 别名、选项 `{ label }` 对象、双轴缺省与简写）；
- 删掉 what 同名槽位的遗留包裹形式（`book: {…}`、`roadmap: {…}`）——名词已经是工具名，没有可嵌套的槽位了。

注册顺序跟随工作流（read → project → book → resource → roadmap → notes → page → cards → quiz → binding → assess）。提示词、service 拒收文案、locale 的 prime 文案、README、presets 注释全部改用新名字；`./tool` 行的注册循环不动（它遍历 definitions）。

## Alternatives considered

- **保留三动词、只瘦描述**：否——缺字段这类错误是结构性的（共享一个 schema 就不存在按 what 必填的字段），认知负担在并集 schema 本身而不在文案。
- **读也拆**：否——读操作选错 what 只是无害重试；再多九个工具是对全局工具列表收税，换不到正确性。
- **保留 `library_write` 兼容壳**：否——没有外部调用方（模型每轮读的是新鲜工具列表）；兼容壳会把我们要教的面翻倍。

## Consequences

- 工具预算 19.1 KB → 21.8 KB（+14%，约 +900 token/轮）：总量略升，是有意的——赢的是单次调用的呈现面（出一次题只见 ~4 KB，而非 14.6 KB 并集）和 schema 线必填。
- 每会话全局工具数 +8；名字自解释，`denyTools` 按名 mask 不受影响（没有任何 profile mask 过旧名字）。
- 旧会话历史里的 `library_write · x` 引用是惰性文本；当前工具列表已是新名字。
- v5 模型提案（[proposals/active/2026-10-16-library-v5-model.md](../../../proposals/active/2026-10-16-library-v5-model.md)）沿用这批名字——`library_quiz` 在 Assessment 合并后继续叫这个名（提案开放项 ② 就此关闭：不改名）。

## Testing

tool.spec.ts 按名词面重写（33 个测试）：schema 线拒缺字段（book / quiz）、JSON 文本传输照解析、建→注册→起草链自动绑定、作用域推导与双轴缺省不变。boot.spec.ts 以 LIBRARY_TOOL_NAMES 断言注册名且逐个带 origin 标签。130/130 绿，`check:panels` 干净。
