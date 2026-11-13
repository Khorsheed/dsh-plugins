# Agent Note：社区插件消费官网导入会话的验收

Status: implemented

[English](2026-11-13-imported-session-plugin-acceptance.md) | 中文

## 问题

宿主 0.2.2-rc.3 新增的官方实验性导入器，可以把 DeepSeek 官网导出转换为普通持久化会话。社区插件理应直接消费这些历史，无需再写一份 ZIP 解析器，但不能只凭面板外观推断兼容性。尤其是，导入的工具结果不能变成本地假文件或假任务，导入器也没有解除恢复自定义 assistant 角色的限制。

## 决策

`packages/basic/tests/imported-sessions.host.spec.ts` 在真实 Web 组合中挂载消息工具、消息时间线、Context Lens、文件预览、TaskPilot、引用和 HTML 内联渲染，再通过真实官方导入器导入一个合成 ZIP。 fixture 包含问题、只有名称而无字节的文件、网页搜索和抓取记录、思考过程、回答及 `dsh-card` fence。

浏览器在展开官方折叠的过程后检查搜索卡和抓取卡，并检查沙箱 HTML 卡。测试选中导入的问题，引用到当前 composer，再打开社区引用 chip 自己的预览，核对原文和来源标题。消息时间线是悬浮导航面板，不是工具栏按钮，因此直接读取它。

Host 侧检查用户事件中保留合成文件引用的名称，同时要求隔离 scaffold 的文件预览列表和官方任务列表均为空，不伪造 `request/header` 事件。Context Lens 读取官方统计的一轮、三步，而不是制造请求元数据。

撤回并恢复导入的 assistant 回复仍走消息工具既有降级：新增 source 为 `{ kind: 'message-tools', op: 'restore-assistant' }` 的 user 角色事件，不新增 assistant 事件。这不代表 S12 已解锁。

所选宿主没有官方导入器时（例如 rc.2），导入器专属浏览器测试跳过。移动端 Workspace 选择器测试使用同一条件。跳过表示版本边界，不证明 rc.3 能力在 rc.2 上可用。

## 未采用的方案

**把导入器复制进 basic，或把导入会话设为套件默认成员。** 否决：官方导入器负责转换，且仍是可选实验包。这里验证组合，不复制职责。

**只做卡片组件测试，或只验证 ZIP 转换成功。** 否决：二者都不能证明真实存储历史能通过实际浏览器、插件服务和官方统计。

**要求出现可下载附件，或宣称可以恢复自定义角色。** 否决：本 fixture 的导出只提供合成文件引用，官方 append/projection 限制也仍在。测试刻意保留这两个边界。

## 影响

候选发布无需改变现有 basic 家族产品的行为，即获得真实组合证据。Canvas 和 eval 接入可复用 Workspace 选择器、真机覆盖及 S12 角色恢复接缝，仍是独立后续工作。

## 验证

聚焦的 basic 测试命令通过标准包测试脚本执行导入会话用例和账号/通知浏览器用例。basic 完整构建和测试通过 3 个文件、9 项测试；mobile 通过 32 个文件、176 项测试，包括官方导入器的真实移动目录流程。

## 相关

- [宿主 0.2.2-rc.3 适配](../process/2026-11-13-host-022-rc3-adaptation.md)
- [完整客户端构建保留版本元数据](../bug-fix/2026-11-13-complete-client-build-metadata.md)
