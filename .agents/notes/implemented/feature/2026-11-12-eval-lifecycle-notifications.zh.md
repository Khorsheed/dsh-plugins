# Agent Note: eval 生命周期通知回到会话，不唤醒 Agent

Status: implemented

[English](2026-11-12-eval-lifecycle-notifications.md) | 中文

## Problem

用户在一个会话里批准实验后，还得自己去别处找运行、判官和人工评估结果。现有实验室分组和 tab 计数有帮助，却不能告诉发起会话是哪个实验有了结果、该打开哪里。通知不能启动模型回合或伪造第二次运行；同一会话里的多个实验也不能被压成一个「当前实验」槽。

## Decision

每个运行阶段或人工评估 ticket 写一条版本化 `plugin:eval/lifecycle` 记录。`EvalRunJobs` 在真实 run report 产生后上报运行完成及实际配置且全部完成的判官阶段；`EvalService.humanFinal` 上报成功且非重复的判定写入。取消、失败、没有判官和重复操作不伪造完成通知。记录带实验/运行身份、标题、阶段和去重键，重试不覆盖其他实验，重复完成不重复打扰。

通知器只通过 `sessions` 或 `agents` 找已挂载的 Session，不创建、不唤醒 Agent，用 `appendPluginRecord` 落盘；读回用 `pluginRecordOf` 校验。原有实验室列表、待处理分组与 `eval_run_status` 保留。通知失败只记诊断，不会把已完成的实验改成失败。新通知面把 eval 与评测套件的 minHost 前移到 0.2.2-rc.2，旧宿主留在上一发布线，未识别记录仍可跳过。

浏览器用轻量结构解析，不把宿主 Session 运行时带进 client bundle。Conversation Definition 按身份渲染一条 `eval-lifecycle-notice`，用 `groupTree: 'turn'` 放在折叠的执行过程组之外。按钮只提交现有的实验室 focus 请求，不切 tab、不提交文本、不启动 Agent 回合；什么时候打开「实验室」仍由人决定。

## Alternatives considered

**追加一条助手文本通知。** 否决：插件记录不进入模型 surface，不冒充模型，也不需要回合。恢复助手投影是另一条仍未支持的接缝。

**用结果消息唤醒发起会话的 Agent。** 否决：可能启动新的模型工作并偏离实验目的。这些是给人看的持久事实，不是提示词。

**只显示徽章或一个「当前实验」槽。** 否决：不同实验和阶段需要独立持久身份。徽章、列表和状态查询继续作为辅助面。

**放进默认折叠的执行过程组。** 真实浏览器验收后否决：内容虽然生成了，但默认不可见。公开 `groupTree: 'turn'` 让通知直接可见，不覆盖 DOM 样式。

**通知到达或点击时立即导航。** 否决：通知不等于允许改变用户当前上下文。实验室 focus 只负责标记实验，tab 仍由人选择。

## Consequences

通知在真实 JSONL 重启后仍能读回，不同实验与人工评估 ticket 互不串扰。宿主掌握完成事实，浏览器负责展示与导航。新的 minHost 是能力所需，不是机械抬地板；源码变更不代表已经部署生产或发布 npm。

运行已包含判官时，运行完成与判官完成可以相邻到达。没有配置判官的实验不会伪造判官完成。真实组合已验证持久记录和实验室 focus 导航；审计不把未来所有插件记录都宣称有通用 Remote 实时转发通道。

## Testing

在 rc.2 通过 eval 94 个测试文件、1491 项测试，其中 notifier 4 项覆盖去重、无判官/取消、异常载荷与真实 JSONL 重启，客户端 3 项覆盖节点投影、精确实验导航与异常/非 ignorable 记录。包与浏览器 bundle 均构建通过。

真实 rc.2 Chromium 评测套件组合显示 `Judging completed: Alpha comparison` 与 `Open experiment`；人工选择「Experiments」后，`New experiment` 和 `Alpha comparison` 均可见，页面与控制台错误均为 0。通知产生过程没有创建或唤醒 Agent。

## Related

- [宿主 0.2.2-rc.2 适配](../process/2026-11-12-host-022-rc2-adaptation.zh.md)
- [官方能力路线](../../../../proposals/active/2026-11-12-host-022-rc2-official-capabilities.md)
- [上游接缝登记处](../../../../docs/upstream-seam-registry.md)
