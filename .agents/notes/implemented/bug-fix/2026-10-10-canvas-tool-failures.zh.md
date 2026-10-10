# Agent Note: Canvas declared failures carry the host error flag

Status: implemented

## Problem

Canvas 在写入被拒绝或资源缺失时返回带失败标签的成功字符串。宿主因此持久化 `isError: false`，耗时诊断少计错误。

## Decision

明确失败分支抛出 `CanvasToolError`，保留原有可操作文案。宿主工具调度器捕获它并生成标准 `isError` 结果。成功输出结构与普通无目标引导不变。不扫描通用响应文本；内容里有失败字样不代表调用失败。

## Alternatives considered

**在 Context Lens 中分类字符串。** 响应文案不是可靠错误契约，而且所有消费方都需要正确标记，因此否决。

**改宿主调度器。** 现有异常路径已能持久化正确结果，无需修改。

## Consequences

直接调用方现在会在明确失败时收到 promise 拒绝；经宿主调度的调用保留有用的模型侧文案并带错误状态。既有文本断言只捕获 Canvas 的专用错误，另有测试验证拒绝契约与无目标引导不变。
