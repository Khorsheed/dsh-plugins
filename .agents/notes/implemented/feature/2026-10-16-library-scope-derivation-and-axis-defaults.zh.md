# Agent Note: 图书馆 —— 路线作用域从 covers 自读；题面双轴缺省

Status: implemented

## Problem

教练实盘里两类反复出现的错误，根源都是工具**强加在每次调用上的决策**，而不是知识缺口。（1）`write·roadmap` 要求选作用域（书的路线 vs 项目自己的路线）——[旅程分流护栏](../../implemented/bug-fix/2026-10-15-library-journey-scope-guard.md) 把选错变成拒收，但模型仍要做这次选择；而且绑定会话的默认值会静默吞掉混合旅程（绑着书时起草混合路线会撞上单书规则，而不是落到项目）。（2）每道考题都必填 `target` 和 `evidence` 两个对象——最高频的写操作扛着两个必填嵌套决策，而它们的缺省答案（"本站主题，依据领域知识"）覆盖了大多数题目。

## Decision

- **作用域推导**（`deriveRoadmapBook`，工具层）：`write·roadmap` 的 `book` 省略（或为 null）时，作用域从脱糖后的 covers 读出来——每站都覆盖同一本书 → 落到那本书的路线；任何混合 → 落到项目自己的路线。显式 `book: "<id>"` 保留为覆盖写法，校验与之前完全一致；binding 的书只供 `chapterRanges` 语法糖使用。这在工具层 supersede 了旅程分流护栏的拒收那一半——选错路变得不可能遗漏——service 里的镜像护栏保留，作为覆盖写法（及一切非工具调用方）的安全网。
- **双轴缺省**（`normalizeQuestionAxes`，工具层）：题目的 `target` 缺省 `{ kind: "topic" }`，`evidence` 缺省 `{ kind: "knowledge" }`；平铺简写自动填充——`cardIds` 蕴含 marked target，`pageId` / `url` 蕴含 photo / web evidence，裸字符串只设 kind。service 的双轴闸门原样不动：它审的是归一化后的形状，所以材料书上缺省出的 knowledge 题照样被拒。
- schema 描述写明新的可选性（两个轴也接受裸 kind 字符串），`write·roadmap` 的 `book` 参数文档改为"省略它"。

## Alternatives considered

- **保留拒收、加强教学**：否——一个模型必须做、而答案就在载荷里的决策是对每次调用收税；直接推导是消灭这类错误，而不是纠正它。
- **service 里的镜像护栏也删掉**：否——service 校验所有调用方（含显式覆盖写法）；护栏留在那里零成本。
- **放宽 service 的双轴校验**：否——引用闸是产品的诚实核心；动的只是传输缺省，判定没动。

## Consequences

- `write·roadmap` 不再需要 `book`；绑着书的会话起草混合路线现在正确落到项目，而不是校验失败。
- 缺省只在写入时生效——已存量的考卷和路线不动。
- 这两件是 v5 模型提案的契约层前奏（[proposals/active/2026-10-16-library-v5-model.md](../../../proposals/active/2026-10-16-library-v5-model.md)）。

## Testing

tool.spec.ts（+5）：同书 covers 无 book 参数落到该书；混合 covers 在绑定书的情况下落到项目；显式覆盖写法仍被校验；裸题存为 topic + knowledge，平铺简写正确填轴；缺省题仍撞材料书引用闸。127/127 绿，`check:panels` 干净。
