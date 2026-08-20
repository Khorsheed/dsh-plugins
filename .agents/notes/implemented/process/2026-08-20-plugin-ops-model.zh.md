# Agent Note: 插件运维模型——三层环境、tarball 进 prod、流程不是审批

Status: implemented

[English](2026-08-20-plugin-ops-model.md) | 中文

## Problem

16 个以上包接近首发，多个 agent 同时向共享 prod(3080）交付，仓库一直没有一套约定好的"插件从开发到社区"的生命周期。 improvis 状态已经产出了它的故障形态：prod 服务的是 `lib/` 目录当时的碰巧内容（15 个 `link:` 依赖——任何一次重启都可能把某人的在制品带上线）;profile 被多个 agent 手改（一个仅子 profile 用的 bundle 被挂进主 profile，直接把组合搞到无法启动）;"什么时候算可以上 npm"除了感觉没有答案。

## Decision

生命周期与规则见 [docs/ops.md](../../../docs/ops.md)。承重的几个选择：

- **三层环境、交付逐层收紧**:`link:` 只用于随手起扔的开发实例；**prod 3080 只收 tarball**（进入 prod 是一个显式的版本决定，绝不是某人 `lib/` 的现状）;npm 在 prod 跑顺之后。
- **六步验收门禁**（每次 profile 变更必过）：构建/测试/卫生全绿 → pack-dist 出包（上一份 known-good 留 `dist-legacy/`，回滚分钟级）→ 刷新 profile → 凭证 + preflight（永不绕过）→ 按闸重启并盯 canary → 公开通报。
- **流程不是审批**：任何开发者都可以把变更开进 prod，但必须开完整条流程——profile 只能由流程写入，禁止手改。实例守护者（kimi-code agent）负责盯拓扑/凭证/漂移、收拾异常，不是唯一司机。
- **独立节奏发布**（不齐步走）,local-agent 家族按依赖序同发；规划中的整合包为**薄元包**：只带 dependencies、自身无 bundle patch，子插件各自自挂载，在整合包内仍可单独装卸。

## Alternatives considered

- **prod 保持 `link:` 图迭代快**——否决：那样任何重启都会带上 `lib/` 的当前内容（包括未完工的活），事故成本远超 repack 成本。
- **守护者作为 profile 唯一写入方/审批人**——否决：既是扩展性差的瓶颈，又会逼出影子编辑；护栏是机械门禁，不是人。
- **齐步走发布**——否决：各包成熟度不同；只有 local-agent 家族需要协调发布（registry 依赖序）。
- **胖整合包（自带 patch 插入全部子行）**——否决：卸单个子插件会与整合包拥有的行打架；薄依赖式让子插件独立可卸。

## Consequences

- [docs/ops.md](../../../docs/ops.md) 是唯一流程参考；[docs/publishing.md](../../../docs/publishing.md) 继续承载 npm 动作清单。AGENTS.md 两处指向它们。
- prod profile 仍带着本决策前的 `link:` 依赖；全量 tarball 化是该规则的首次执行，排在 ankh-guard 监督拓扑改造落定之后。
- message-timeline 发与不发、local-agent 家族版本线对齐（claude-code 还在 rc.5)、整合包命名与版本策略，留待验收轮拍板。
