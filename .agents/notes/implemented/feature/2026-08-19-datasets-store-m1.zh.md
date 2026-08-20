# Agent Note: datasets store M1 — 服务内核、git 对象直读、托管 sparse-checkout worktree、会话绑定

Status: implemented

[English](2026-08-19-datasets-store-m1.md) | 中文

## Problem

[datasets 提案](../../../proposals/active/2026-08-19-datasets-store.md) 从 datasets-mission 合并提案中拆出通用版本化数据集存储：数据集是 git 仓库内容，带语义契约（descriptor 形状、层可见性类别）、版本固化与按会话的访问治理。M1 交付整个 host 面——仓库布局约定、`ctx.datasets` 服务内核、七个模型工具、CLI、slash 命令、会话绑定、托管 worktree 与测试——零官方代码改动，不依赖 mission/lab 姊妹提案。

## Decision

交付为 `packages/datasets`（`@khorsheed/dsh-datasets`），loader 入口 id `datasets`（身份三角：`cordis.patch.yml` 行、tsdown 入口集、`src/invariant.ts` 的 PACKAGE_NAME）。单一服务内核（`src/service.ts` 的 `createDatasetsService`）支撑全部三面；模型工具（`src/index.ts`）、`dsh-datasets` CLI（`src/cli.ts`）与 `/datasets` slash 命令都是它的适配器。

- **布局 + 形状校验**（`src/dataset.ts`）：`datasets/<id>/dataset.json` + `items/<item-id>/item.json` + `<layer>/…`。只校验形状（非空 layers 清单、布尔 `modelFacing` 缺省 true、`itemMetaSchema` 存在即对象）；其余 descriptor 字段与文件原样透传。**用 JSON 不用 YAML**：本包依赖链上没有 YAML 解析器且任务禁止为此加依赖，v1 读 `dataset.json`/`item.json`；README 的 Known Limitations 已注明。
- **单一存储**：所有读取来自 git 对象（`git show`/`git ls-tree`，先解析 commit，`src/git.ts`）。没有逐文件 spawn git 的拼装物化动词，也没有复制出口。
- **白名单即机制**：scope（`{repo, datasets?, layers?}`）传入服务；`list`/`show` 按它过滤，`read` 越界即拒（`LAYER_NOT_ALLOWED`），`worktree_path` 与之求交——交集为空即明确报错。`put_item` 同样拒绝白名单外或 descriptor 未声明的层：写 agent 读不回的内容是不对称的。绑定存在时白名单一律生效，即使调用带显式 `repo`（绑定人拥有会话可见性的决定权）。
- **托管 worktree**（`src/worktree.ts`）：缓存键 (realpath(repo), commit, 排序 layers) → `<root>/<repoHash>/<commit>-<layersHash>/`；`git worktree add --detach` 后 `sparse-checkout set --no-cone /datasets/<id>/items/*/<layer>/`（该模式恰好覆盖每个 item 目录下被允许的层——被拒层物理不存在，有测试验证），再 `git worktree lock`。同键创建用 `<dir>.lock` mkdir 锁串行化（带 stale 破除）；缓存键两侧都经 realpath 归一化（macOS `/var` 与 `/private/var` 不得分裂缓存）。注册表即 `git worktree list`；`prune` 只解锁并移除指定仓库的托管条目。invariant 伴侣（`src/invariant.ts`）在加载期检查托管根的结构完整性。
- **会话绑定**（`src/binding.ts`）：按会话持久化的绑定，写入只走人的路径（slash、web tab、CLI）。**存储已被取代**：初版是 log-only `datasets/binding` session 事件（`goal/change` 先例）——下游自定义事件类型按构造不可重建（无已知类型注册面、`Session.append` 无 `ignorable` 通道），绑定遂迁入插件自管存储（`<stateRoot>/bindings/*.json`）；该决策由[恢复毒化 bug-fix note](../bug-fix/2026-08-20-downstream-session-events-unresumable.md) 持有，`src/session-log.ts` 随之删除。
- **工具**（`src/index.ts`）：`datasets_list / show / describe / read / snapshot / worktree_path / put_item`，经 `defineTool` 注册，handler 由 `exec.agent.session` 解析会话；显式 `repo` 优先于绑定，完全无 repo 来源时明确报错并提示如何绑定。`systemPrompt` 引导段经 `ctx.get` 探测（极简 composition 没有该服务——降级而非爆炸）。`inject: ['commands', 'tools']` 遵循提案（base bundle 恒挂载两者）。

## Alternatives considered

- **为 YAML descriptor 新增依赖**——否：提案本身就点名了 JSON 退路且禁止为此扩大依赖链；`dataset.json` 让 v1 保持诚实，未来有 YAML 能力的线可两者兼容。
- **CLI bind 走宿主 RPC**——否：宿主 CLI 没有这种接缝（`dsh` 只暴露 `web`/`plugin`）；直接追加 JSONL 日志是适配器局部但真实的做法，zstd 帧布局按结构复现（magic + 头 + block 遍历）而非靠猜。
- **整层逐文件 `git show` 读取**——提案已否（每个视图几十个 git 进程）；托管 worktree 是唯一的整层路径。
- **`--no-checkout` add 再物化的 sparse-checkout**——因可靠性否决：`--no-checkout` 后的 index 状态随 git 版本漂移，而 add 后 `sparse-checkout set` 确定性地裁剪工作树（创建时的短暂全量检出只多花一点 IO）。
- **白名单只在读绑定所属仓库时生效**——否，因为不够保守：白名单强度由绑定人决定，显式 `repo` 是选择器而非授权升级。

## Consequences

- mission/lab 姊妹方可以零耦合消费 `ctx.datasets`（snapshot 引用、层可见性元数据、`worktree_path` 视图）；它们缺席时对本包不可见。
- `put_item` 只写工作树；本包无任何 commit 动作。worktree 是共享只读缓存：消费方写脏一个，由 `prune` 重建，插件不做防御。
- descriptor 语义（评测布局里的 rubric/stages/schemas）归数据集作者；插件唯一的意见是形状。

## Testing

`packages/datasets/tests/`——6 个文件 39 个测试，fixture 是运行时临时目录里的 git 仓库（`os.tmpdir()` + `mkdtemp`，无任何本机路径）。覆盖面对应提案验收标准：白名单强制（含 worktree 物理不含被拒层目录）、同键去重（进程内与两个 spawned CLI 进程间）、仓库演进下的 pin 稳定、`prune` 解锁且只移除托管条目、绑定存储的写/读/解绑往返与重启持久化（session 事件 fold 与离线 zstd 追加随存储迁移移除）、`read` 不产生仓库外拷贝、`put_item` 写工作树且 HEAD 不动、CLI 退出码语义、bundle patch 身份行。

## Cross-references

- [datasets 提案](../../../proposals/active/2026-08-19-datasets-store.md)——本实现对应的设计（M1）。
