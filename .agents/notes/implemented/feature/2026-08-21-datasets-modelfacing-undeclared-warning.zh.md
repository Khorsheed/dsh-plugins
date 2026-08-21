# Agent Note: 混合敏感度数据集中未表态 modelFacing 层的告警

Status: implemented

[English](2026-08-21-datasets-modelfacing-undeclared-warning.md) | 中文

## Problem

层缺省 `modelFacing` 为 `true`。在混合敏感度数据集（声明了任何 `modelFacing: false` 层）里，未显式声明该键的层更可能是作者忘了表态，而不是刻意公开：descriptor 会被当模板抄，verify 层泄给选手就意味着 overfit。翻转默认值语义是错的（通用数据集的默认行为不该被污染），硬错误又会拒掉按缺省合法存在的存量数据集。正确的强度是告警。

## Decision

形状校验在错误之外新增告警计算。`DatasetLayerDecl` 记录 `modelFacingDeclared`（键是否出现）；`src/dataset.ts` 的 `descriptorWarnings(descriptor)` 只含一条规则：当任何一层显式 `modelFacing: false`、且另有层未声明该键时，对每个未表态层产出一条 `MODELFACING_UNDECLARED` 警告。纯公开数据集（没有任何 false 层）与全部显式声明（无论方向）的数据集保持安静。告警绝不阻断读取。

告警随数据集摘要走（`DatasetSummary.warnings`），每个面无需新动词即可呈现：CLI 在 `list`/`show`/`describe` 时打到 stderr（describe 动词改经 `show` 读取——descriptor JSON 完全一致，且摘要随之前来）、slash 命令经 `formatWarnings` 附在输出末尾、模型工具的 JSON 输出天然携带（agent 看到同一信号）、Remote 结果在摘要上携带（对象内增量字段——exact-arity 教训不适用，产物已重新生成）、web tab 在数据集行下逐条渲染安静警告行（用 `{code, layer}` 数据本地化，不用宿主的英文 message）。刻意跳过「挂载时经宿主日志告警」：插件没有加载期的数据集扫描，也不知道加载时哪些仓库被绑定；逐数据集的告警属于读取面，不属于启动日志。

## Alternatives considered

- **混合数据集里未表态层直接报硬错误**——否决：会把按文档缺省合法存在的存量数据集打死；存疑不等于违约。
- **存在隐藏层时把默认值翻成 false**——按题设否决：默认值语义是通用数据集行为，不得随内容翻转。
- **挂载时扫描 + 宿主日志告警**——否决：没有这种扫描；插件在加载期不知道绑定仓库；逐数据集的告警应跟着读取走，不进启动日志。
- **只在 CLI 呈现**——否决：信号的消费者是数据集作者，他们在每个面上工作；摘要是所有面本来就共享的载体。

## Consequences

- 数据集作者在工作的每个面上都能收到提醒：每个未表态层一行、指名道姓。告警词汇全是增量（`DatasetSummary.warnings`、`DescriptorWarning`）——钉死精确形状的消费方需容忍新字段。
- `validateDescriptor` 的返回形状不变（decl 加一个字段）；告警计算是描述符上的纯函数，可独立测试。
- 工具的 JSON 输出现在带告警——agent 可能主动向用户提及，这是预期行为。

## Testing

`packages/datasets/tests/`——9 个文件 66 测试全绿。新增覆盖：三种触发情形（混合 → 逐未表态层一条；全显式 → 安静；纯公开 → 安静）、校验期的 `modelFacingDeclared` 记录、摘要经服务与 Remote 结果携带告警、CLI `list`/`show`/`describe` 的 stderr、tab 的安静警告行。所有读取路径在告警存在时照常工作。

## Cross-references

- [datasets store M1](2026-08-19-datasets-store-m1.md)——本告警所依附的可见性类别声明。
- [题集级层](2026-08-20-datasets-dataset-level-layers.md)——层名跨两级；声明（及本告警）附着在名字上，两级按构造同受覆盖。
- [datasets 提案](../../../proposals/active/2026-08-19-datasets-store.md)——可见性类别语义（`modelFacing` 是数据声明；导出闸归导出方）。
