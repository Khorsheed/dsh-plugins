# Agent Note: Claude 原生模型目录与有界控制

Status: implemented

## Problem

Claude 成员菜单此前只有配置项和历史标识符。stream-json 中断处理还把任何匹配响应当成成功，未回答的控制一直挂起。CLI 没有 models 命令，但 initialize 控制可以提供原生菜单元数据。

## Decision

有界、绑定 scope 的 initialize 查询接入 core 目录缓存，保留原生选择别名、显示名、解析模型名及明确提供的 effort 选项。缺少目录能力、成功的空目录和查询失败分别表达。原生候选与历史建议保留独立来源。成员查询及历史回读使用该成员实际 scope 和 cwd。

查询不提交用户任务，禁用 hooks 与 MCP 加载，不持久化会话，也不复制凭据或写入模型设置。目录查询与常驻运行时共用带关联 ID、超时、错误回执、取消和进程死亡清理的控制通道；现有中断改用此通道。

本地 Claude 2.1.272 的隔离 initialize 探测在没有用户任务时返回了原生别名、解析名称和 supportedEffortLevels。这证明元数据形态，不证明真实认证后的出模或账号权限穷举。实际适配器跟随实例 PATH 解析 CLI；本机有多个版本，验收实例必须明确所用二进制。

## Alternatives considered

**复制 OAuth token 请求厂商 HTTP。** 不采用，原生 CLI 已能解析自身端点、设置和认证，并提供菜单词汇。

**用解析模型名替换别名。** 拒绝，因为动态别名是选择意图，显示解析结果不能把它钉成固定版本。

**收到 initialize ack 就删除常驻设置绕行。** 延后，必须接入原生换模控制，并在后续真实 fresh/resume 轮次验证实际模型。本提交不改变该运行时选择路径。

## Consequences

Claude 现已接入丰富目录与刷新订阅合同。旧 CLI 的能力缺失或查询失败会明确降级。共用 UI 和持久 model/effort 选择仍属提案后续工作；目录有 effort 元数据不代表执行旋钮已经可用。

## Testing

测试覆盖原生显示名、别名、解析名、推理值、不支持与错误格式、scoped 无任务查询、进程关闭、控制拒绝后的过期缓存、回执关联、超时及进程死亡。Claude 完整包级测试通过，包括流式与中断回归。
