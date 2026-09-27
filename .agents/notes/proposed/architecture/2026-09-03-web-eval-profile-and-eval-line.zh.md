# Agent Note: web-eval profile and the eval line

Status: proposed

[English](2026-09-03-web-eval-profile-and-eval-line.md) | [中文](2026-09-03-web-eval-profile-and-eval-line.zh.md)

## Problem

路线图把 `dsh-eval` domain 整合包（base + local-agent 家族 + mission + datasets + lab）标为 ⬜ 并排到 P2，但三个机制插件已交付 M1–M4 却没有跑过一次真实评测：题库仓库的 `runs/` 与 `exports/` 为空，操作手册里编排器角色通篇 ❌，设计讨论反复重开同样的决定（rep 与 attempt、驱动模式、沙箱、prompt 来源），因为没有一份文档钉住目标架构。eval 线的工作同时在三条战线上散开——插件通用性、题库内容、公平性基线——没有顺序，也没有完成判据。

两轮评审（2026-09-02/03）发现通用机制本身是稳的，但评测这一层没有一等的受试对象（「选手」只是一个自由标签字符串）、没有判定输出契约、local-agent provider 不 pin 也不回读模型、四家的 exec/live 驱动混用、推理强度不对称且未受控（kimi 的 provision 写死 `effort = high`）、prompt 由母 agent 现写使题面文字成为一个未测量的因子。

## Proposal

现在就立起 `profiles/web-eval/`，形态与 `dev` 相同（package.json 成员清单、`[]` patch 层、install/update/restart 脚本仅改名），并让它的 README 成为在写更多代码之前钉住**目标**的唯一文档：

- 六层架构（对话 / 契约 / 编排 / 机制 / 执行 / 存储），规则是编排器是唯一执行者，agent 只做规划与初稿，人做审批、终评与导出；
- 三份在 I1 定稿的契约 schema——`condition.json`（可哈希的受试对象：scoped home 内容 + env 键 + argv 模板 + 物化包）、`plan.json`（快照 × 条件 × rep × 阶段 × 顺序 × 预算 × 判官）、`verdict.json`（探针与判官的输出契约）——放进数据集作者协议，与 `dataseek.verify/1` 并列；
- 22 个成员插件加一个待建包 `@khorsheed/dsh-eval`（宿主插件 + CLI + `eval-planning` skill），从 `scripts/integration-triad.mts` 长出来；
- 十二条冻结的公平性决策（rep = mission、全 exec、沙箱交给容器边界、pin 推理强度、模型 pin 与回读、字节级 prompt、超时归编排器、活跃时长预算、判官 ≠ 选手、跨家用成本不用 token、随机交错、销毁路径唯一）；
- 迭代计划 I0–I6，带可观察的完成判据，顺序是契约 → 手工走通一格 → 编排器 v0 + 阶段一二 pilot → 容器 + 阶段三四 → 放宽因子 → agent 配实验 + 界面 → 外部评测集 + 发布。

路线图的 domain 表现在指向该 profile README；整合包名为 `dsh-web-eval`，与 `dsh-dev` 一致。I0 不改任何插件代码。

## Alternatives considered

**把计划放进 `proposals/` 文件而不是 profile README。** `package-management` 提案已经拥有整合包的分发形态（形态 B）；缺的是整合包自己的目标架构与迭代顺序，而每个 profile 的 README 都承载这些。再开一份提案会重复分发故事，profile 目录仍然不存在。

**先写编排器代码，让架构自己长出来。** 过去三周就是这样：只有动词没有驱动器。操作手册的 ❌ 清单说明驱动器才是产品；在契约形状未定时写它，条件一旦超出 harness 就得重写一次。

**先放宽因子（harness × 模型、preset、skill），因为那是既定目标。** 否决，改为在 I1 定死条件哈希的形状、到 I4 只让 provider 认识更多字段；先在四家 harness 上出一份结论，会把任何多因子 run 都要继承的判官、rubric、去指纹问题提前暴露。

**现在就把评测 pin 作为 profile 的 patch 层发出去。** 本轮没有在活实例上验证各 provider 配置的 loader patch 语法；I1 在 pin 被真正用过之后再决定是 pack 自带 patch 还是用户层。

## Acceptance criteria

- `profiles/web-eval/` 存在，含 README（中英 + 已登记的 sidecar）、列出 22 个成员的 package.json、`[]` patch 层、LICENSE、workspace 文件、CHANGELOG 与三个脚本；restart 脚本与 dev 只差名字。
- `docs/roadmap.md` 的 domain 表写明 `dsh-web-eval` 并链接到 profile README。
- README 写明目标架构、各插件所需改动、三份 schema 的意图、工具按域开放表、目标流程、最终 UI 面、十二条冻结决策以及带完成判据的 I0–I6。
- `profiles/web-eval/docs/architecture.md` 承载能力地图（插件 × 面 × eval 域使用者）、自然语言到实现的 24 步轨迹（每步的能力与生成文件）、文件位置表以及报告必须核对的四条不变量；`docs/iterations.md` 承载插件 × 层的落地矩阵（每项标注已满足 / 需改 / 待建与迭代）、带依赖的逐迭代任务表 T1–T36、四段 I1 指引文案原文以及验收规程。
- 仓库门禁通过：hygiene（无绝对本地路径）、Agent Note 格式与分类、翻译配对。

## Risks

- **计划可能像之前的一样腐烂。** 缓解：每个迭代的完成判据是可观察状态，README 写明未达到不进下一迭代。
- **安装路径未验证。** 三个成员是未发布的 rc 线，第二波 npm 之前 profile 只能从源码 tarball 安装。README 已说明。
- **冻结决策在 I1 验证之前只是观点。** 其中一些（复合指纹、模型回读）需要改 provider，可能暴露 CLI 的限制；这些记为 I1/I3 的发现，而不是悄悄放松决策的理由。
- **命名。** `dsh-eval` 同时被用于路线图的整合包和编排器包；README 已区分（整合包 = `dsh-web-eval`，编排器 = `@khorsheed/dsh-eval`），但读旧文档的人仍可能混淆。
