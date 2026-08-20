# Agent Note: 题集级层——共享内容纳入层白名单管辖

Status: implemented

[English](2026-08-20-datasets-dataset-level-layers.md) | 中文

## Problem

评测题集布局需要跨 item 共享且有可见性治理的内容（判定时才挂载的 `verify/helpers/` 目录）。[M1](2026-08-19-datasets-store-m1.md) 的布局只在 item 级有层；数据集根部文件一律是 descriptor 透传——原样携带、不读、且在层白名单管辖之外，因此放在数据集根部的 rubric 目录对任何绑定会话都可见。这是真实的治理漏洞，不是缺失的便利。

## Decision

层目录现在可以存在于两个级别：`datasets/<id>/<layer>/…`（题集级，跨 item 共享）与 `datasets/<id>/items/<item>/<layer>/…`（item 级，不变）。规则纯粹按名字判定：顶层目录的名字声明在 descriptor 的 `layers` 清单里，它就是题集级层；其余顶层条目保持 descriptor 透传，与之前一样不可经读取路径到达。`items` 是保留的 item 容器，作为层名会在校验期被拒。

所有机制在两级统一生效：

- **白名单**：`list`/`show` 报告题集级层（`datasetLayers`，按白名单过滤）；`read` 省略 `item` 即读题集级文件（`ReadQuery.item` 变为可选）。
- **题集级读取的声明闸**：省略 item 的读取路径可寻址任何顶层目录，因此额外要求该层已声明（`LAYER_UNDECLARED`）——没有这道闸，未声明的透传目录会变得可经工具读取，正好重新打开本次要关的洞。item 级读取保持 M1 语义（其路径离不开 `items/`）。
- **worktree**：`layerSparsePatterns` 每层同时产出 `/<dataset>/<layer>/` 与 `/<dataset>/items/*/<layer>/`，托管 worktree 在两个级别都物理只含允许的层。
- **`modelFacing`**：声明按层名，天然两级适用——无格式变化。
- **tab**：题集级层归于 item 列表之前一个安静的「共享」分组，与 item 内层组同样的文件夹行呈现；选中共享文件的读取不带 item 选择子，预览 header 显示「共享」分组名。

线变化（增量、预发布线）：`ListItemsResult`/`ShowResult` 增加 `datasetLayers`；`ReadQuery.item` 变为可选。两者都在请求/响应对象内，exact-arity 教训不适用；gen-typert 在同一构建里重新生成产物。

## Alternatives considered

- **独立的 `shared/` 容器约定**（`datasets/<id>/shared/<layer>/…`）——否决：要多一个保留目录名和第二族 sparse 模式；按名字的两级规则两者都不需要，且在仓库里读来更自然。
- **透传可经 `read` 到达**（任何顶层目录都可寻址）——否决：它会把每条绑定会话的读取路径伸进未声明内容，正是本次要修的治理洞；声明闸保持透传语义不变。
- **共享文件专用 Remote 动词**——否决：省略 `item` 的 `read` 是同一操作在更宽路径上的延伸；第二个动词只会分叉白名单逻辑而没有语义收益。
- **`modelFacing` 改成按级别声明**——否决不必要：可见性类别附着于层的语义（内容是什么），不附着于目录位置。

## Consequences

- 题集布局可以治理共享内容：`verify/helpers/` 放题集级，对选手会话白名单不可见、其 worktree 中物理不存在。
- 同一层名在两个级别共存可用（item 级与题集级读取是不同路径）；测试钉死共存。
- 线增量对 tab 源码兼容（加字段、一个字段放宽为可选）；钉死结果精确形状的消费方需容忍新键。
- descriptor 作者多一条校验错误：层名 `items` 会 fail loud。

## Testing

`packages/datasets/tests/`——9 个文件 57 测试全绿。新增覆盖：题集级列表按白名单过滤且只认声明（`drafts/` 透传永不列出）、省略 item 的题集级读取（含同名层两级共存）、透传目录的 `LAYER_UNDECLARED` 与被白名单拒的共享层的 `LAYER_NOT_ALLOWED`、两级 worktree sparse 模式与物理存在/不存在、保留层名 `items`、CLI 的 `shared:` 列表行、tab 的「共享」分组渲染与无 item 读取。

## Cross-references

- [datasets store M1](2026-08-19-datasets-store-m1.md)——本次扩展的布局约定（其布局条目指向本 note）。
- [datasets M2](2026-08-19-datasets-m2-remote-tab.md)——tab 面；其树与 Remote 事实已为「共享」分组与线增量更新。
- [datasets 提案](../../../proposals/active/2026-08-19-datasets-store.md)——本 change 为共享内容补全的治理模型。
