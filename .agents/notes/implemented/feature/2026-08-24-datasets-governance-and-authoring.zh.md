# Agent Note: 默认安全、operator 视图、register 映射、validate 动词与作者协议文档

Status: implemented

[English](2026-08-24-datasets-governance-and-authoring.md) | 中文

## Problem

两份评审过的提案在同一轮收敛。[datasets 提案](../../../proposals/active/2026-08-19-datasets-store.md)的评审中项：① 绑定未显式列层时敏感（`modelFacing: false`）层仍对 agent 可读——缺省是「全部」；② 白名单把人的 tab 也拦了——看一眼 rubric 就要永久放宽 agent 边界，是最糟的交换。[作者协议提案](../../../proposals/active/2026-08-23-dataset-authoring-protocol-skill.md)的 M1：协议没有落档文档、没有 `validate` 动词、没有 `register` 映射——自由形态的文件必须搬进约定目录才有角色。

## Decision

四项全部落在 `@khorsheed/dsh-datasets` 的同一个服务内核上：

- **默认底线**：`effectiveLayers(scope, descriptor)` 是所有层闸路径共同咨用的唯一上限。operator scope → 不过滤；显式绑定白名单 → 就是它（列出敏感层是刻意的）；无白名单 → 数据集声明了敏感层时只放 `modelFacing:true` 层，没声明时行为不变（不过滤，未声明的 item 级目录也在）。底线覆盖 list/show/read/put_item 与 worktree 缺省；显式 `layers` 请求与底线求交（交集为空才报错——M1 语义）。`DatasetScope.operator` 标记人的视图：tab 的 Remote 读取与 CLI 读取动词按 operator 运行（白名单约束 agent 的工具与 worktree 物化，不约束读自己仓库的人）；CLI `worktree path` 保持非 operator（它是容器边界）；`previewRepo` 是 operator（绑定人要看全部才能选）。
- **register**：`dataset.json` 新增可选 `register: [{item, layer, files}]`，把 **item 相对**路径或单层 glob（`*` 不跨 `/`，禁 `**`）映射到角色——取 item 相对是因为一致性样本（dataseek-eval 的 harness-comparison，P0-placeholder）按此构建且是验收夹具；附录的「路径必须在仓库内」宽松表述在该样本中读作 item 域内。`buildRegistry` 对 commit 的文件清单展开 glob，布局冲突（同一显示路径被约定目录与同角色 register 同时覆盖）、精确路径悬空、越界、重注册 `item.json` 一律 fail loud；glob 零命中允许（内容可以后到）。注册文件在 `list`/`show` 归位到声明角色（显示名 = item 相对路径），`read` 解析显示名 → git 对象，纯 register 的 item 参与列表，被注册认领的文件不再同时以物理目录伪层身份出现（部分认领的目录只留未认领余量）。worktree 把注册路径翻译成 sparse 模式：精确对象路径与单层 glob 以非 cone gitignore 模式上车（`/datasets/<id>/items/<item>/<pattern>`），并入缓存键。
- **`datasets_validate`**（CLI 动词 + `datasets_validate` 工具）：逐数据集形状错误 fail loud（CLI exit 1；警告不阻断），三类警告——`MODELFACING_UNDECLARED`（已有）、`FIELD_NAME_SENSITIVE`（item.json 键含 note/hint/answer/rubric/grading 词根——item.json 永远可见）、`UNREGISTERED_FILES`（未被层目录或 register 覆盖的文件掉进永远可见的透传区；glob 单层通配盖不住子目录是高频踩法）。校验按 operator 语义看全部：它的职责就是报告透传区。CLI `describe` 改经 `show` 读取（descriptor JSON 一致，摘要携带警告）。
- **tab 树规则**：register 注册的文件按声明角色归位；无内容的层不显示；透传区单列成组（「透传 · N 个文件 · 不受白名单保护」——`ListItemsResult.passthrough` 上线）；敏感层对人照常可读、带「· 敏感」标记；绑定表单折叠区的层勾选初始化为 modelFacing 底线（展开即确认也不会悄悄越过默认）。
- **冒烟后细化**（同轮用户反馈）：(1) item.json 在 item 展开时显示一行 `item.json · 不受白名单保护`——选择不并入题集级透传计数，因为逐 item 一行把警告放在作者写元数据的正下方，并入分组则每 item 一条会淹没信号；(2) 层行加第二个标记 `· agent 可读`（本会话 agent 可见层：绑定的显式 layers，否则 modelFacing 底线）——只标可读是因为默认拒绝后可读是少数；标记随绑定变化实时重渲染（这是用户确认改白名单生效的通道）；(3) 共享组标签改为「题集级共享」/`Dataset-level shared`，消歧两级同名层（demo 树上被读成「visible · visible」的来源）；(4) 绑定条/表单文案把白名单叫直白——`agent 可见：…`，未写 layers 时显示「agent 可见：可见层（敏感层默认拦截）」，取代不准确的「全部 layers」；(5) 在 IDE 树定型上做密度精修（19px 参考线步进、item 标题层级、预览 header 成条、产物 tab 式内容区呼吸），不改既有形态。
- **协议文档**：`docs/dataset-authoring-protocol.md`（中文，仓库 Chinese-first 惯例）+ `docs/dataset-authoring-protocol.en.md`，版本 v1-rev1。其中 `dataset.json` 示例是合法 JSON（注释放围栏外），在 `tests/protocol.spec.ts` 里直接过校验器——双语两份都测，文档与实现不会漂移。

线面增量（全走对象，exact-arity 教训不涉及）：`ListItemsResult.passthrough`；`ReadQuery` 不变；`DatasetScope.operator` 是 host 内部。产物已重新生成。

## 上线后修正：人可点读透传文件

后续冒烟发现透传行（题集级透传区与 item.json 行）只列不读——与消费者拆分自相矛盾（「不受白名单保护」是警告标注，不是读取拦截；operator 视图不拦人）。修复：新增 `datasets/readPassthrough` Remote 方法（请求对象查询 `{dataset, path, commit?}`，遵循 exact-arity 教训）从 git 对象直读任意数据集相对路径文件——明确定位为 operator 专用通道：无层上限、刻意不暴露为模型工具。tab 的 selection 改为 kind 标记的联合类型（layer | passthrough）；透传行与 item.json 行成为可点读的文件行，走与层文件同一预览管线（item.json 经 JsonTree 渲染）。「不受白名单保护」标注保留——它警告，不再拦截。agent 面不变：item 元数据按协议经 list/show 对 agent 可读，agent 工具没有新增透传内容通道。

## Alternatives considered

- **无敏感声明时也只放声明过的 modelFacing:true 层**——否决：会 newly 隐藏普通数据集里未声明的 item 级目录；底线只在声明了敏感性时才介入。
- **repo 相对的 register 路径**（附录的宽松读法）——否决：一致性样本（验收夹具）注册的 item 相对路径在仓库根部不存在；item 域内也更安全（register 永远够不到 item 之外）。
- **静默跳过悬空的精确注册路径**——否决：写错的精确路径是破掉的 descriptor，应 fail loud。glob 允许零命中（内容后到），反向由 `UNREGISTERED_FILES` 覆盖。
- **validate 按调用方上限过滤视图**——否决：validate 是作者的卫生工具，必须报告透传区，而透传区按定义任何层上限都看不见。
- **空勾选组落 `[]`**——否决：schema 里缺省读作「全部」、`[]` 读作「全拒」；表单改为禁止全不勾组（见 M2 note）。

## Consequences

- 未显式列层的绑定默认更安全：agent 不再看到敏感层，除非绑定显式列出。operator 面（tab、CLI 读）不受影响；`worktree_path` 缺省同样收窄——容器只物化模型可见层，除非显式要求。
- 存量托管 worktree 失效一次（缓存键并入注册模式）；`worktree prune` 收走。
- `datasets_validate` 工具按设计不过滤——校验的 agent 看得到数据集的完整层词汇（层名是低敏元数据；内容仍受闸）。
- CLI `describe` 现在会顺带列出 item（改经 `show`）——动词略重，输出不变。
- 协议文档是单一事实源：校验器一致性测试、绑定表单预填、（后续）skill 都从它派生。

## Testing

`packages/datasets/tests/`——12 个文件 87 测试全绿。新增：service.spec 的底线块（混合集默认收窄、operator 全见、显式白名单刻意放宽、无敏感声明数据集不变、写路径随底线、worktree 请求静默求交）、register.spec（形状约束、角色归位、纯注册 item、读取解析、worktree 物理内容、冲突与悬空 fail-loud、不重复显示与部分认领余量规则）、validate.spec（三类警告、逐数据集错误隔离、CLI 退出码）、protocol.spec（双语两份的 `dataset.json` 示例过校验零告警）、remote.spec 的 operator 视图改写（tab 从不收窄；同测试内工具边界保持白名单）、tab 的透传/敏感/底线用例。:3091 活实例对 `dataseek-eval` 冒烟验证树形态（透传行、共享敏感层、register 归位）与 `dsh-datasets validate` 的真实输出。

## Cross-references

- [datasets 提案](../../../proposals/active/2026-08-19-datasets-store.md)——其两条评审中项在此落地（默认底线、消费者拆分）。
- [作者协议提案](../../../proposals/active/2026-08-23-dataset-authoring-protocol-skill.md)——其 M1 在此落地（协议文档 + validate 动词 + register）。
- [datasets store M1](2026-08-19-datasets-store-m1.md) 与 [datasets M2](2026-08-19-datasets-m2-remote-tab.md)——本轮扩展的 host 面与 tab；其中过时事实指向本 note。
