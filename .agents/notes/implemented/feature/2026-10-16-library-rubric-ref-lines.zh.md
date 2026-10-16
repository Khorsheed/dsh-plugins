# Agent Note: 图书馆 —— 验收行有稳定 id，且可由测验机检（v5 第一刀）

Status: implemented

## Problem

同一个微积分实盘会话里暴露出 practice 站设计的两处摩擦：（1）一个「做完练习 + 过测验」才算完的站只能拆成两个节点——practice 站挂不了测验，验收行「完成本站测验 ≥ 通过线」只是教练目测的 prose，不是系统跑的检查；（2）verdict 靠验收行的**逐字文本** join，重排时改个措辞，历史判定就成孤儿。

## Decision

- **验收行获得稳定位置 id**（`L1`、`L2`…，types.ts 的 `acceptanceLines()`）：verdict 现在按行 id 或逐字文本（旧形式）解析，落账时记规范 id + 文本。重排改措辞不再孤儿化历史。
- **行可以机检**：写作 `{ line, ref: <考卷 id> }`（卷子必须先存在——形状校验否则拒收）。验收时 service 用被引卷子最新一场自动判 ref 行（过线 = 得分 ≥ 路线过线率，`by: "auto"`），拒收教练对它们的 verdict，并折进同一个 ratio 与级联。ref 行失败不建卡——测验那场已经给错题建过卡。
- ~~practice 验收 tab 按 rubric 渲染~~ **后被取代（2026-10-16）**：验收 tab 已移除，练习验收只走会话——见 [验收 tab 移除](../simplification/2026-10-16-library-acceptance-tab-removal.zh.md)。本 note 在 service 侧的机检不变：ref 行仍按被引卷子最新一场自动判，其余行教练按行 id 判（教练读路线处皆有行 id）。
- `LibraryVerdict.by` 扩 `'auto'`（从不接受自调用方）；attempt 的 normalize 保留它。
- 本刀刻意**不做**：Assessment 实体落库（practice rubric 独立成文件）与 `Attempt` 的单 `assessmentId` 键——它们随第二刀（Resource 合并）一起走，那时整个存储布局都要动。盘上 `quizId | nodeId` 双键照旧。

## Alternatives considered

- **允许测验挂到 practice 站**：否——那会分叉关卡语义（一站两条完成路径）；ref 行保持单一关卡（验收），机检只是其中一行。
- **practice assessment 落文件**：本刀否决——派生 rubric（行序位置 id）零迁移；落文件要多一条采用时写入路径，而在 Resource 合并前没有任何能力增益。

## Consequences

- 练习+测验两节点模式收回一个站：rubric = [机检的测验行， 人判的作品行]。
- 存量字符串行与逐字 criterion 的判定记录原样读回（兼容由未改动的旧测试覆盖）。
- 带关卡 practice 站的教练顺序变为：先出题（书级、不挂站），再起草路线引用它。

## Testing

service.spec.ts（+1）：ref 全流程——未知 ref 起草即拒、无判分记录时机检不过、教练判 ref 行被拒、卷过线 → 自动过 → 完成并解锁、auto verdict 读回仍在。tool.spec.ts：经 `library_roadmap` / `library_assess` 的行为不变。131/131 绿。
