# Agent Note: datasets canary field and tool-group registration

Status: implemented

中文 | [English](2026-09-07-datasets-canary-and-tool-groups.md)

## Problem

两件评测域的需要，且 dev 域必须察觉不到。

**泄题取证。** 一个评测题库进入某个模型的训练语料的那一刻，它就失效了，而今天没有任何东西告诉作者这件事发生过。Terminal-Bench 的做法是金丝雀：在题集每个可见文件里埋同一个全局唯一串，日后拿它去搜模型输出。机制本身几乎零成本，贵的是纪律——「任何一个可见文件都不许漏埋」，而这恰恰是作者在题库变大之后无法靠肉眼保证的。

**工具按域开放。** 在 [dsh-web-eval](../../../../profiles/web-eval/README.md) 里，agent 只出现在规划期与分析期：读题、起草，凡是执行都属于编排器。因此它不该握有 `datasets_worktree_path`——整层物化是编排器的动作。preset 表达不了这件事：preset 收窄的是某个 scope 能够到什么，而 profile 层注册过的工具对该 profile 里的每个 agent 都存在。唯一能决定的地方是注册本身，也就是插件。

## Decision

两件都落在 `@khorsheed/dsh-datasets` 里，`all` 档的行为与改动前逐字节相同。

**`canary`** 是 `dataset.json` 的可选字符串，形状校验为非空（建议格式 `dsh-canary:<dataset-id>:<uuid>` 是协议建议，不是被校验的模式）。声明它就打开一条新的 `validate` 警告 `CANARY_MISSING`：`modelFacing: true` 层里的每个文本文件都必须逐字包含该串，缺的逐文件报一条，并写明文件与「让它可见的那个层」。检查范围刻意在四个方向上收窄——未声明 canary 的数据集完全不查；敏感层与 `item.json` 不在范围内（它们本就不会经本插件到达模型）；「文本」按扩展名白名单判定（`md` / `txt` / `yml` / `yaml` / `json` 与无扩展名）而不是嗅探内容；register 归位的文件按**角色层**判定而非物理位置，于是 register「位置与角色解耦」的语义在这里同样成立。

这是插件里唯一读文件内容的规则，因此只跑在 `validate` 路径上——`descriptorWarnings`（随每次 `list`/`show` 摘要走的形状级规则）保持同步且廉价。`canaryWarnings` 放在 `dataset.ts` 里其他警告规则旁边，走与其余读取相同的 git 对象路径，不物化任何东西。

**`tools: 'all' | 'read' | 'authoring' | 'none'`**（缺省 `all`）是一条包含链：`read` = 六个读类动词，`authoring` = read + `datasets_put_item`，`all` = authoring + `datasets_worktree_path`，`none` = 什么都不注册。定义保持无条件、照常打 origin 标签，被拦的只有 `ctx.tools.register`——由一个读取该档位名字集合的 `registerTool` 助手拦。`datasets:tools` 提示词段由同一个集合装配：只在工具真的存在时才提 `datasets_worktree_path` 与 `datasets_put_item`，`none` 档下连段都不贡献——因为讲一个不存在的工具不是无害的多余话，而是一条错误指令。`all` 档下装配出的文本与此前那个固定串逐字节相同。

服务、`dsh-datasets` CLI、`/datasets` 与会话 tab 天然在分组之外：它们是人的面，而这里划的是 agent 的边界。评测域的建议档位是 `authoring`。

## Alternatives considered

- **由插件生成或注入金丝雀**（做一个 `datasets canary init` 动词，把串写进每个可见文件）——否决：插件从不解释数据集语义，也从不写自己没被交付的内容。造串与埋串是有 git 评审兜着的作者行为；「检查」才是机器做得更好的那半，而只做检查已经足以让这条纪律可执行。
- **按内容嗅探文本/二进制**（用 NUL 字节或 UTF-8 探测代替扩展名白名单）——否决：那要把题集里每个文件都读一遍才能分类，而且它的失败方向是坏的那个——一个恰好看着像文本的夹具会收到作者无从处理的警告。白名单只会漏覆盖，而漏覆盖对选了这个扩展名的作者是看得见的。
- **未声明 canary 也报一条**——否决：那会在每个现存数据集上响，而「对现有题库零新增警告」正是这次改动必须过的那条线。字段是选择性加入的，不用它是正当选择。
- **连 `item.json` 一起查**（它本来就永远可见）——否决：它是受声明 schema 约束的元数据，不是题面内容；要求它埋串会逼作者往一份结构化文档里塞一个无处安放的注释字段。item.json 的卫生规则已经由 `FIELD_NAME_SENSITIVE` 拥有。
- **配置里直接列工具名**（`tools: ['datasets_list', …]`）——否决：那让每个 profile 各自重新推导一遍读写边界，且在改名或新增工具时静默腐烂。命名分组意味着新工具只在知道它属于哪一档的那个包里入档一次。
- **做成 `readOnly: boolean`**——否决：这里三条有意思的边界里有两条不是「它写不写」（`put_item` 写工作树，却属于作者域；`worktree_path` 只写缓存，却是编排器的动作）。布尔量必然要在其中一条上撒谎。
- **提示词段各档一致**——否决：让模型用一个它没有的工具去整层消费，换来的是一次失败调用加一段混乱的自救；而这段文本本来就能从「决定注册与否」的同一个集合里装配出来，成本极低。

## Consequences

- 默认部署不变：八个工具、同一段提示词文本、在 descriptor 主动声明之前不做任何金丝雀检查。`pnpm check:plugins` 与既有测试套钉住了这个形状。
- 对声明了 canary 的数据集，`validate` 的代价是每个可见层文本文件一次 `git show`。这是内容级检查的价格；它不上摘要路径，所以 `list`/`show` 与从前一样廉价。
- 作者协议双语同步到 **v1-rev3**：§2 增加 `canary` 字段（示例 descriptor 现在自己就声明了一个，于是文档的示例即校验器的夹具），§5 增加 `CANARY_MISSING` 条目。
- 设 `tools: 'none'` 的 profile 仍然保有完整的人机面——插件降级到 CLI/tab/slash，而不是降级到什么都没有，这正是这一档可以放心设的原因。
- 把 `tools: 'authoring'` 组进 web-eval profile 是另一次改动；本次只让这个设置存在，并写明建议。

## Testing

`packages/datasets/tests/` —— 14 个文件 99 条测试全绿。新增 `tools-group.spec.ts`（缺省档的八个工具，以及提示词同时点名两个写动词；`read` / `authoring` / `none` 三档的工具集合与各自提示词里被去掉的从句；`none` 档不贡献段而服务与 slash 命令照常存活；`toolsOfGroup` 上的包含链），以及 `validate.spec.ts` 里的金丝雀块——夹具里每种必须被区分开的情形各放一个文件：题集级与 item 级可见层、一个落在 item 根的 register 归位文件、一个无扩展名文件、一个敏感层、`item.json`、两个非文本文件；未声明 canary → 完全不查，全都埋了 → 静默，抽掉两个文件的串（一个层文件、一个 register 归位文件）→ 恰好报这两条并写明可见层，抽掉敏感层与 `item.json` 的串 → 仍然静默。`protocol.spec.ts` 现在钉住文档示例里金丝雀的形状，于是这个字段不可能从协议文档里悄悄掉出去。

## Cross-references

- [datasets governance and authoring](2026-08-24-datasets-governance-and-authoring.zh.md) —— `validate`、既有三条警告、register 角色模型与本次扩展的协议文档都归它所有。
- [dsh-web-eval](../../../../profiles/web-eval/README.md) —— 本次为 datasets 实现的就是那张「工具按域开放」表。
