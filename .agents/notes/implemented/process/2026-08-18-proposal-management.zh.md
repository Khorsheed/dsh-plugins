# Agent Note: 能力提案总账（proposals/），done 判定绑定可插拔交付

Status: implemented

English | [中文](2026-08-18-proposal-management.zh.md)

## Problem

dsh-plugins 缺一层"能力意图"管理。Agent Note（`.agents/notes/`）记录单次决策，生命周期是 proposed → implemented → rejected，但一个**能力**横跨多个包、多个 PR、多个 note——没有任何东西跟踪某个意图的能力是否存在、以什么形态存在、谁在推进。历史能力账本在本仓库之外（dsh-salvage-2026-08-16 的个人提案快照），"想做的"与"已以可插拔插件交付的"之间的缺口在这里不可见——用户要求在本仓库内建 proposals 目录，带状态跟踪、实现后及时关闭，管理方式参考 Agent Note。第二个约束让账本的"完成判定"不再平凡：既定目标是**每个能力都以用户可插拔插件交付、零官方代码改动**——所以"在补丁流里实现了"不能算 done。

## Decision

- **新增顶层 `proposals/` 目录**，与 `.agents/notes/` 独立：

  ```
  proposals/
    README.md / README.en.md   管理规范（中文主文档 + 英文镜像，对齐根 README 惯例）
    backlog.md                 能力缺口池：对历史提案快照的沉淀盘点
    active/                    进行中的提案：idea / planned / in-progress / blocked
    closed/                    done / closed（放弃 / 被取代 / 官方吸收）
  ```

- **一个提案 = 一个能力意图**，命名 `YYYY-MM-DD-<slug>.md`（沿用 Agent Note 命名）。状态**路径编码**：`active/` vs `closed/`——镜像 Agent Note 的"目录即生命周期"，状态变更必然伴随文件移动。
- **状态机**：`idea → planned → in-progress → verified → done`；`blocked`（必须写原因）作侧支；任意状态可 `closed`（必须写理由）。**状态变更 = 改头部 + 移动文件 + 更新 README 总表，同一 commit。**
- **done 判定绑定可插拔交付**：`done` 要求能力以独立插件包交付（`dsh.bundle` 自挂载、`dsh plugin remove` 可卸）。依赖补丁的实现最多标 `verified`，**永远不算 done**，且必须写明去补丁化路径。被官方吸收 → `closed`。
- **头部固定键、机器可读**（`分类 / Classification`、`状态 / Status`、`最后更新 / Last updated`、`查重结果 / Duplicate check`、`官方依赖 / Official dependency`），为将来的校验脚本留口，但**现在不加任何 gate**——这是轻量约定层。
- **防停滞**：`idea`/`planned` 超 14 天未动，或 `verified` 超 7 天未转 `done` → 总表标 ⚠️ `stale`；三选一（升优先级 / closed 注明理由 / 保留注明理由）。每次工作会话开始先扫总表。
- **与 Agent Note 衔接**：实施提案时的每次非平凡改动仍然要写 Agent Note（AGENTS.md 不变）；提案可选的「实现记录」小节登记相关 note / PR / 包名。提案不取代各包 `issues/`，也不取代发布计划。
- **Backlog 池**：`backlog.md` 把历史盘点中所有"还没可插拔交付"的能力登记成清单（个人 setup 已实现项、计划/想法项，以及只在 docs 总览里出现的两个能力：dataseek 与 whalenap 等待内容），按迁移成本分组，另附"已插件化"对照表防止重复提案。认领 = 建 `active/` 文件 + 总表加行 + backlog 该项标注「已认领 → 提案 `<slug>`」。

## Alternatives considered

### 为什么不放进 `.agents/proposals/`？

`.agents/` 是 agent 工作流面；提案是给人（维护者、贡献者）决定"接下来做什么"看的，顶层 `proposals/` 与 `packages/`、`docs/` 一样容易被发现。Agent Note 的约定（路径编码生命周期、日期 slug 命名）无论放哪都照样借用。

### 为什么不把能力跟踪并入 Agent Note？

Agent Note 回答"为什么这么改、放弃了什么"，针对单次决策；一个能力跨多次决策，比任何单次决策都长寿。并入会让 note 的单生命周期模型被撑破，或在 note 里重复维护一张账本。两层刻意分离，用提案的「实现记录」做交叉链接。

### 为什么不把 38 份历史提案文件复制进本仓库？

它们是另一个语境（补丁流、个人化）的冻结快照；复制会引入过时细节，并制造一份必须同步的第二权威。真正有持久价值的是盘点结论——能力清单 + 当前实现形态 + 官方依赖判定——所以沉淀进 `backlog.md`。

### 为什么现在不配提案头部校验脚本 / gate？

Agent Note 的 gate 是因为 README 承诺了机械强制且已观察到漂移；提案还没有这类承诺，对一个年轻目录加 gate 只有维护成本。固定头部键已为将来的脚本留口，不必现在就付钱。

## Consequences

- 能力意图在仓库内有了单一入口，且 done 判定把"零官方改动"目标写进了判定规则：依赖补丁的实现不能冒充 done——这正是用户要的纪律（"实现后及时关闭"）。
- 个人历史 backlog 以可认领清单的形式保留下来，不会随归档快照丢失；对照表防止重复提案。
- 提案保持纯约定：无新脚本、无新 gate、无 pre-commit 改动——目录就是文档 + 一张总表，靠与 Agent Note 同款的"移动文件"纪律维护。
- 任何在本仓库干活的 agent 开工前应扫 `proposals/README.md` 与总表，和扫 notes 树同一节奏。

## Testing

- 新文件 `pnpm check:hygiene`：0 findings（无绝对路径、无凭据形字符串、无工具/scratch 状态）。
- `pnpm run verify-translation-pairing --write` 重录了 Agent Note 配对；`verify-agent-note-format` / `verify-agent-note-classification` 全树绿。
