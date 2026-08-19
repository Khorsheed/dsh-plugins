# Agent Note: Clearing-fit analyzer — 按实测负载形态为准入门槛

Status: implemented

[English](2026-08-19-clearing-fit-analyzer.md) | 中文

## Problem

连续工具结果清理插件（Anthropic `clear_tool_uses` 式：把 keep 窗口之外的旧 tool result 替换为占位符）用每次清理事件一次 KV 前缀失效，换取之后每次调用更小的提示词。这笔交易是否划算完全取决于部署的负载形态：花费是否集中在长会话、上下文中 tool result 占比多少、越过触发线后还剩多少次调用。不设准入检查就发布插件，会把一个破坏缓存的策略推到纯亏的部署上，而且任何部署属于哪一边此前无从得知。

## Decision

`scripts/analyze-clearing-fit.ts`（含配套 spec）读取部署的会话日志（`session.jsonl[.zstd]`，用纯 JS 的 `fzstd` 解码，无原生依赖），在启用策略之前给出答案。它逐会话回放 surface 操作，测量峰值上下文规模、该点的 tool result 占比与数量、给定 `keep` 窗口下的可清理量，以及实测的越线后调用次数（S）。然后按 2026-08-17 调价后官方 deepseek-v4-flash 价格推导的收支模型逐会话计价：一次事件成本为幸存前缀 × (miss − hit)，之后每次调用节省释放量 × hit，回本需要 `n* = C'(m−r)/(F·r)` 次调用；实测 S 超过 2×n* 的会话判为净正。汇总判定为：净正会话承担 ≥30% 缓存读取花费时输出 ENABLE，并按保守 S=100 以中位合格上下文给出建议 `clearAtLeast` 下限。默认值：1M 窗口、0.4 触发比、keep 15、谷时价 $0.007/$0.22 每 1M（峰时价 miss/hit 比值相同，判定与峰谷无关）。2026-08-19 对生产 profile（`~/.dsh-official/sessions`，165 个会话）的实跑返回 ENABLE：6 个净正会话承担 81% 缓存读取花费，回本 44–112 次调用对实测 S 130–5320，建议 clearAtLeast ≈ 153K token。

## Alternatives considered

- **不设准入检查直接发布插件** —— 否决：同一机制在集中、工具密集的负载上省钱，在小型或 reasoning 主导的负载上白白破坏缓存；错配启用是纯亏，而且用户事后很难诊断。
- **复用 harness 的 session/persistence 包做回放** —— 否决：脚本必须能在没有 harness 检出的情况下对任意 `$DSH_HOME/sessions` 运行，因此直接解码 JSONL/zstd 格式并重新实现所需的二十行 surface 回放；格式有版本控制，脚本对单文件响亮报错而不是静默误读。
- **调用 `zstd` CLI** —— 否决：macOS/Linux 开发机默认不装；`fzstd` 是纯 JS，已对多帧生产日志验证。

## Consequences

- 该脚本目前是仓库工具；清理插件发布时，分析器随插件一并发布（包 `scripts/` 或文档化的 `tsx` 调用），作为推荐的启用前检查，本笔记中的实测默认值将成为插件配置文档的种子。
- 估算是启发式而非账单：上下文规模按 chars/4 估算，事件数按每会话一次建模，S 取自历史实测——三者都偏保守（真实节省随会话变长而增大；缓存冷时事件免费）。脚本会打印所用模型，用户可用 `--hit-price`/`--miss-price` 自行重新计价。
- Reasoning 内容（本部署线上上下文的另外约 60%，被 DeepSeek thinking 模式的 passback 规则锁定）在该策略射程之外；分析器的 tool 占比列让这一天花板对每个部署可见，避免用户期待策略无法交付的节省。
