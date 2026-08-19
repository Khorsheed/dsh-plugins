# 提案管理（Proposals）

English | 中文

> 本目录是 dsh-plugins 的**能力提案总账**：一个提案 = 一个**能力意图**的完整生命周期（从想法到关闭），可以跨多个包、多个 PR、多个 Agent Note。提案**实现后及时关闭**——关闭的提案移入 `closed/`，绝不长期挂着。

## 与 Agent Note 的分工（先读）

| | Agent Note（`.agents/notes/`） | Proposal（本目录） |
|---|---|---|
| 粒度 | 一次决策 / 一次改动 | 一个能力意图（可跨多个包 / PR / note） |
| 回答的问题 | 为什么这么改、放弃了什么 | 这个能力做不做、做到哪了、谁在推进 |
| 生命周期 | proposed → implemented → rejected（+ archived） | idea → planned → in-progress → verified → done / closed |
| 强制程度 | AGENTS.md 强制，pre-commit 有格式 gate | 本目录约定，无机器 gate（轻量文档层） |

**衔接规则**：

- 一个提案实施中的**每次非平凡改动仍然写 Agent Note**（AGENTS.md 要求不变）；提案正文的「实现记录」小节登记相关 note / PR / 包名，方便审计。
- Agent Note 的 `proposed/` 是"尚未实施的单次决策"；若它服务于某个提案，可在 note 中链接回提案（反之亦然）。

## 目标宣言（所有提案的共同判据）

本仓库所有能力最终以**可插拔插件**交付：`dsh plugin add / remove` 一条命令装、一条命令卸，**零官方代码改动**——不修改、不替换、不 hack 官方包。由此派生出三条硬规则：

1. 每个提案头部必须如实标注**官方依赖**：`纯插件` / `需契约扩展（upstream 候选）` / `当前依赖补丁`。
2. **done 的判定绑定可插拔交付**：能力以独立插件包交付（含 `dsh.bundle` 自挂载、可热卸载）才算 `done`。依赖补丁的实现最多标 `verified`（补丁流环境验收），不算 done，且必须写明**去补丁化路径**。
3. 能力被官方吸收（官方自带，无需插件）→ `closed` 并注明「官方吸收」。

## 目录与生命周期

```
proposals/
  README.md / README.en.md   本文件
  active/                    进行中的提案：idea / planned / in-progress / blocked
  closed/                    已关闭：done / closed（放弃 / 被取代 / 官方吸收）
```

文件命名：`YYYY-MM-DD-<slug>.md`（slug 用英文小写连字符；与 Agent Note 命名同款）。**路径编码状态**是刻意为之——状态变更必须伴随文件移动，防止"改了状态忘了归档"。

## 状态机

```
idea → planned → in-progress → verified → done（移入 closed/）
          ↘ blocked（写原因；解除后回 in-progress）
任意状态 → closed（放弃 / 被取代 / 官方吸收，注明理由，移入 closed/）
```

| 状态 | 含义 | 所在目录 |
|---|---|---|
| `idea` | 想法，未立项 | active/ |
| `planned` | 已立项，待开工 | active/ |
| `in-progress` | 实施中 | active/ |
| `blocked` | 卡住，**必须写原因**（缺前置 / 等 seam / 等上游） | active/ |
| `verified` | 验收通过（探针 / 实测全绿；补丁流环境可用） | active/ |
| `done` | **以可插拔插件交付并验收**（零官方改动） | closed/ |
| `closed` | 放弃 / 被取代 / 官方吸收（注明理由） | closed/ |

**状态变更 = 改文件头部 + 移动文件 + 更新 README 总表，同一 commit。**

**实现后及时关闭**：`verified` 后应在 7 天内转 `done` 并移入 `closed/`；拖着不关会被标 ⚠️ stale。`done` 是"关闭"不是"开始新工作"——能力交付即归档，后续增量走新提案或 note。

## 防停滞

- `idea` / `planned` 超 14 天未动，或 `verified` 超 7 天未转 `done` → 总表标 ⚠️ `stale`。
- stale 三选一：升优先级拆任务 / `closed` 注明理由 / 保留注明理由。
- 每次工作会话开始先扫总表，stale 项优先处理。

## 提案文件格式

头部（固定键，机器可读；状态/分类/官方依赖/最后更新变更时同步）：

```markdown
# <能力名>（<slug>）
- **分类**：plugin | seam | patch
- **状态**：<状态机中的值>（blocked / closed 时括号内写原因）
- **最后更新**：YYYY-MM-DD
- **查重结果**：<搜过 active/ + closed/ + .agents/notes/（含 archived）的结论>
- **官方依赖**：纯插件 / 需契约扩展（upstream 候选）/ 当前依赖补丁（去补丁化路径：…）
```

正文骨架（bespoke 技术小节可自由加在中间）：

```markdown
## 目标
## 现状（官方契约实测 / 已有实现）
## 方案
## 里程碑（可选）
## 实现记录（可选：相关 Agent Note / PR / 包名，随实施追加）
## 验收标准（done 判定，绑定可插拔交付）
## 风险 / 放弃的东西
```

## 查重铁律

新建提案前必须搜过：`active/` + `closed/` + `.agents/notes/`（含 archived）。命中已有 → 追加原文件不新建（同意图增量更新同一份，不改意图才新建）；拿不准开新还是更新 → 问一句，一行成本。

## 与其他机制的关系

- **提案 ≠ issue**：实施中的问题（bug / 验收反馈）写各包 `issues/` 或直接在实施 PR 里解决，不占提案。
- **提案 ≠ Agent Note**：见开头分工表。
- **提案 ≠ 发布计划**：发布批次 / 版本线看各包 version + `dsh plugin` 流程，提案只关心能力做没做、以什么形态交付。

## 总表

> 起步为空（本体系 2026-08-18 建立）。历史提案档案留在原快照（dsh-salvage-2026-08-16，本仓库外），不迁入；新提案按上文流程在此加行。

| 分类 | 提案 | 状态 | 官方依赖 | 前置 / 依赖 | 备注 | 最后更新 |
|---|---|---|---|---|---|---|
| plugin | [通用版本化数据集存储（datasets）](active/2026-08-19-datasets-store.md) | planned | 纯插件 | — | 独立可用；与 mission 可选兼容 | 2026-08-19 |
| plugin | [通用任务管理（mission）](active/2026-08-19-mission-tasks.md) | planned | 纯插件 | bench 仓库模板（评测用法） | 独立可用；与 datasets 可选兼容 | 2026-08-19 |
| plugin | [受控实验单元（lab）](active/2026-08-19-lab-experiment-units.md) | idea | 纯插件 | datasets（`worktree_path`）· mission（`is-releasable`） | 填补 mission/datasets 有意留白的资源生命周期；provider 第一版仅 docker | 2026-08-19 |
| plugin | [local-agent 公开委派 API（start / resume / cancel + 进度事件）](active/2026-08-18-local-agent-delegation-api.md) | planned | 纯插件 | 无（原 codex 持久化 note 第 1 条已吸收进 M4） | room note 的供给侧立项；M1–M4 代码已落地（未推送），待真实 profile 验收 | 2026-08-19 |
| plugin | [local-agent 成员双向通道（可写 composer + promptMember + 成员互通知）](active/2026-08-19-local-agent-member-channel.md) | planned | 纯插件 | local-agent-delegation-api（底座 M1–M4） | room 二轮评审立项；替代不可行的 prepareContinuable 路线（§0 存档）；M3 = CLI→CLI 成员互通知（room 高频场景） | 2026-08-19 |
