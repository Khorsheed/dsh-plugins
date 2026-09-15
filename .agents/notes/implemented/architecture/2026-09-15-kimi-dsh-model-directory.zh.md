# Agent Note: Kimi 会话配置与 DSH 适配器目录

Status: implemented

## Problem

Kimi 丢弃原生会话配置，模型 broker 也读取默认 scope。DSH 把适配器枚举缩成标识符，丢失显示名和推理能力。长期目录订阅还可能一直保留每次配置变化产生的旧缓存身份。

## Decision

Kimi 从 session/new、session/load 和 config_option_update 记录原生配置，包括轮次之间的更新。映射首个 model 和 thought_level select 分类，单独保留原生控制 ID，仅为当前选择的模型关联依赖它的推理选项。旧 models 元数据保留为只读兼容来源。读取目录不创建临时 ACP 会话；尚无常驻原生元数据时，显示实际 scoped 配置候选，并明确标为配置来源、不完整。

DSH 通过公开宿主适配器枚举和可选 resolveModelInfo 保留路由 ID、显示名、描述及适配器原生推理值。缺少的能力保持未知。部分 provider 失败标为不完整；整体刷新失败则保留旧数据并标过期。这是子 profile 初始化使用的宿主目录，不证明被单独修改的 scoped 运行时仍有相同配置。

两家与 Codex、Claude 共用 core 缓存、刷新 Remote 和订阅。缓存现在淘汰无人使用的旧身份，保留已打开订阅与进行中的查询。

协议参考：[ACP v1 会话配置](https://agentclientprotocol.com/protocol/v1/session-config-options)。本地 Kimi 0.42.0 隔离探测完成 initialize，未登录时 session/new 返回需要认证。真实认证后的模型和配置行为仍待验收；协议解析器不构成此项证据。

## Alternatives considered

**每次打开菜单都创建一个 Kimi 会话。** 拒绝，目录查询不应留下临时会话，也不应为了显示配置候选而发起生成。

**把当前会话的 effort 列表套到全部模型。** 拒绝，ACP 配置选项可能依赖当前模型并一起变化。

**用宿主 DSH 目录证明 scoped 运行时。** 拒绝，必须由轮次准入和后续观测确认成员实际配置。

## Consequences

家族四家 provider 现已实现丰富目录读面和订阅。共用菜单、持久选择状态和可执行 effort 通道继续接入，本提交不改变选择语义。各家未知项保持明确，不编造统一的模型或 effort 词汇。

## Testing

Kimi 测试覆盖原生与旧格式解析、配置回退、原生替换、当前模型推理选项，以及轮次之间的配置通知和会话过滤。DSH 测试覆盖路由、显示名、effort、部分枚举、刷新失败和缺少公开能力。Core 验证淘汰旧身份时不丢失正在查看的目录。
