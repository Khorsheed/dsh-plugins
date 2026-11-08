# Agent Note: 编辑消息恢复自己的历史模型

Status: implemented

[English](2026-11-08-message-tools-edit-historical-model.md) | 中文

## Problem

消息编辑器的模型 chip 显示会话 `ModelDirectory` 的当前选择。编辑较早的消息时，重发可能悄悄换到另一个模型，常见的就是默认 DeepSeek 路由。在外部 CLI 成员协调的房间里，这个原生 chip 更有误导性：room 会把编辑触发转交给该成员，原生选择根本不控制生成。

## Decision

`messageTools.editModel` Remote 只读还原目标消息实际使用的原生模型证据，不写日志。它检查目标之后、下一条人类消息之前的首个模型 step，把助手消息与适用的请求头配对；路由跨轮未变时复用最近且匹配的较早请求头，失败 step 内的请求头也记录实际尝试的路由。证据缺失或矛盾时返回 `null`，绝不猜当前默认值。

编辑器把恢复的路由保存为草稿，打开与取消都不改会话。保存时先等待共享 `ModelDirectory.select()` 完成 host 校验，再调用 edit RPC；选择被拒绝时不替换消息，也不触发重新生成。查询为 `null` 时不渲染 chip，也不写原生模型选择。外部 CLI 房间因此继续走现有 `routeEdit` 派发和成员当前模型配置。[message-tools 原始实现记录](../feature/2026-08-15-message-tools-edit-withdraw.md) 中的模型 chip 决策按此修订。

## Alternatives considered

**继续使用会话当前或最近使用的模型。** 否决：这两个值都属整个会话，不属被编辑消息；较早消息可能先于它们。

**打开编辑器就切回历史路由。** 否决：取消仍会改变会话，而只改显示更不负责任。模型选择属于保存编辑这一动作。

**给 room 和 local-agent 增加仅本次编辑的模型覆盖，或把 CLI 模型解释成原生 `ModelSelection`。** 本次否决：它们是不同的路由词汇，需要新的跨插件写入路径、成员历史配置语义和逐派发覆盖。隐藏无效的原生 chip，保留成员现有行为，不虚构这套契约。

## Consequences

原生编辑现在默认使用实际处理目标消息的 provider、模型与推理强度，包括较早消息和已编辑消息。用户仍可另选路由，但只在保存时生效。外部 CLI 编辑不宣称恢复成员历史模型，而是使用成员当前配置，与房间输入框一致。

本包 14 个测试文件、246 个测试覆盖逐消息路由恢复、未变请求头、失败 step、无证据降级、草稿选择、保存顺序、选择失败和外部 CLI 行为。
