# Agent Note: Core 轮次准入与 Codex 配置绑定

Status: implemented

## Problem

如果只有 facade 检查持久化待应用配置，实际运行仍可能绕过它：直接 subagent 工具也能调用 provider。仅验证后续选择的控制器不会验证创建时的配置；成员空闲期间默认值也可能变化。

## Decision

Core 持有成员运行绑定，校验 provider、父会话、cwd、scope 和创建配置，并在 provider 入口取得整轮租约。每次操作重新查找当前 adapter，避免设置重载后继续捕获已销毁的 driver。Provider result 结束时释放租约，启动失败也释放。准入准备阶段验证配置并解析默认值；准备过程中到达的新选择会在发送 prompt 前完成应用，原生准备与配置应用不会并发。

Registry 和 gateway 暴露统一的持久化配置状态，以及带关联标识的选择、撤销、重试和订阅。已接入 adapter 的 provider，其兼容换模入口也走同一待应用槽。创建请求可携带原生 effort 与冻结条件锁，两者保留在委派记录中；resume 继承它们，不能接受未记录的覆盖值。

Codex 首先接入此边界。Adapter 区分继承成员配置与跟随 harness 默认值，依据所选模型的原生目录校验显式 effort，并在变化时回收空闲运行时。下一轮 live 的原生 `turn/start` 携带准入时的 model 与 effort；进程覆盖参数和 exec argv 使用同一快照。协议结构已对照本机 CLI 生成的 JSON schema 检查。请求、解析配置与实际生成观测保持分离。

## Alternatives considered

**仅保护 facade 启动。** 不采用，因为直接工具启动可以绕过一致性合同。

**每个生成步骤读取可变 broker override。** 不采用，因为整个模型/工具轮次必须保持准入配置。

**重启后重放结果不明的原生 prompt。** 不采用。恢复只回收空闲 Codex 运行时并准备持久化配置，不重放生成。

## Consequences

共享选择器、其他 provider adapter、评测冻结条件调用方和完整运行时验收仍在进行中。配置确认不能视为生成模型的观测。现有 live scope 限制与原生默认值解析局限仍需专项接入。本批不改变生产 profile 或认证状态。

## Testing

Core 全量 299 项测试通过。新增准入测试覆盖 provider result 释放、启动失败、身份/scope/锁不匹配、默认值刷新，以及准备期间再次选择。Codex 测试覆盖原生 effort 校验与恢复线程时 `turn/start` 的准入 model/effort；两个包均构建通过。
