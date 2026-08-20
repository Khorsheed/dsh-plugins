# Agent Note: 包管理——分类、整合包形态与发布流程

Status: proposed

[English](2026-08-21-package-management.md) | 中文

## Problem

仓库正处于首发门槛（截至 2026-08-21 的 20 个包中只有 ankh-guard 上了 npm——latest 0.1.0-rc.8.9——其余 19 个未发布），却没有一套把「插件分类 → 可分发整合包 → 发布流程」串起来的具体方案。[plugin-ops-model](../../implemented/process/2026-08-20-plugin-ops-model.md) 定了三层环境生命周期并勾画了薄元包，但把薄元包的命名/版本策略与真实机制留作 open item。对照 harness 源码（`apps/cli/src/plugin.ts`、`packages/boot/app-boot/src/profile.ts`）的契约实测显示：当前 CLI 无法挂载薄元包——`pnpm add <pack>` 只把 pack 写成直接依赖，而 `reconcilePlugins` 只扫直接依赖——成员装上了但永远不会挂载。任何建立在 ops.md「薄元包」一行字上的计划，都是在缺口上盖楼。

## Proposal

把包管理作为一个能力跟踪在 [proposals/active/2026-08-21-package-management.md](../../../proposals/active/2026-08-21-package-management.md)，其上游 seam 跟踪在 [proposals/active/2026-08-21-upstream-meta-pack-reconcile.md](../../../proposals/active/2026-08-21-upstream-meta-pack-reconcile.md)：

- **分类**：每个包加 `dsh.category`（`base` / `domain` / `ops`，主标签唯一；领域包加 `dsh.domain` 备注如 `eval`），README 总表同步。分类是标签，绝不是物理 bundle。盘点矩阵还跟踪宿主兼容（`minHost` 硬下限 / 信息性 `latestHost` 缺省 = minHost，拟落为 `dsh.compat.latestHost`）、npm 已发布版本（以 registry 为准）、共享 GitHub 仓（各自 `packages/<dir>`；message-timeline 仍缺 `repository` 字段），以及 bundle-vs-plain 区分（19 bundle + tool-subagent plain）。
- **分发形态**：A——add 清单脚本（今天可用）；B——profile 目录模板（repo/tgz 分发，成员为直接依赖，今天可用，首发推荐）；C——npm 薄元包（目标形态，被上游 seam 阻塞）。
- **发布流程**：每包独立线（首发除 local-agent 家族同发外无顺序问题）；整合包用 `^` 范围，只在成员增删或跨大版本线时 bump，不随成员 patch 发布而 bump。
- **首发应用**：`dsh-eval` 整合包（datasets + lab + file-preview 对 + client-message-tools + taskpilot + 基础层去掉 ankh-guard），形态 B 先行；`dsh-novel` 等小说领域插件。

## Alternatives considered

- **胖整合包（自带 patch 插入全部子行）**——plugin-ops-model 已否决，本提案沿用：卸单个会与 pack 拥有的行打架，破坏一包一行自挂载约定。
- **字面意义的「按人群 profile」当可分发物**——否决：profile 绑定机器的 `$DSH_HOME` 与 node_modules；可分发的是 pack（目录模板或 npm 薄元包），profile 只是装配现场。
- **随每个成员 patch 发布而 bump pack（ops.md 的说法）**——否决，改用 caret 范围 + 仅成员变更 bump：发布更少，安全性不降（成员各自声明兼容性）。
- **上游设计 1（展开式）vs 设计 2（闭包扫描 + 排除表）**——seam 提案推荐设计 1：无新 manifest 状态、复用原生 pnpm remove；设计 2 作为上游偏好最小改动时的备选。

## Acceptance criteria

- 分类机械可查（`dsh.category` 存在且与 README 一致）。
- 空 profile 一条命令装出 dsh-eval 全家（现在用形态 B 脚本/模板；seam 落地后用 `dsh plugin add <pack>`）；任一 bundle 单独 `remove` 后其余不受影响、实例干净启动。
- 至少一个包走通 pack-dist → npm publish → 消费者冒烟全链路；整合包能从空 profile 复现装出。

## Risks

- 上游拒绝 seam → 形态 C 搁置；A/B 长期承载整合包，缺口登记 upstream seam registry。不阻塞交付。
- 分类主观性（datasets 横跨基础与评测）→ 主标签唯一 + `dsh.domain` 备注，避免标签爆炸。
- pack 的 caret 范围漂移 → 成员自声明 `dsh.compat`；pack 在跨大版本线时收紧范围。
- 工作树并发：本 note 与提案是纯文档；盘点里程碑（M1）会动各包 package.json 的 `dsh.category`，必须避开并发 agent 在途的包改动。
