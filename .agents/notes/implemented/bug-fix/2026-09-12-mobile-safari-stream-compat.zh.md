# Agent Note: 将 Safari 流式兼容限定在移动端入口交付层

Status: implemented

## Problem

iPhone 会话在重连后停止发布正文事件，统计却持续变化。宿主 JSON 值校验将原生构造函数源码与 V8 专用字符串比较，误拒绝 Safari 普通对象；随后普通 TypeError 结束 journal 消费，但 Session 仍显示 open。[上游报告](../../../../docs/upstream-proposals/2026-09-12-safari-assistant-stream-resume.md)记录了保留的现场和这两个独立缺陷。

## Decision

用户授权由移动端承担临时兼容层，宿主检出保持不变。移动端随包分发的可选 HTTPS ingress 接受 `MOBILE_SAFARI_COMPAT=1`，在求值前适配 WebKit 对官方 `/plugins/` JavaScript 的 GET 请求。对完整已知发布构造函数进行 SHA-256 校验，仅规范缩进和构建器名称后缀；只把 V8 专用字符串替换成当前 realm 的原生构造函数字符串。名称、构造函数/原型身份与 JSON 校验保持不变。

组合 bundle 中的已知副本全部适配；存在变化的候选时整次适配原样透传，已修复代码不处理。生产代码不引入广泛替换、全局 monkey patch、Session 私有字段访问或第二套会话协议。ingress 默认不启用兼容，应从已安装 tarball 运行，避免使用可变开发检出。

只缓冲成功且 identity 编码的 JavaScript，限制为 16 MiB。向上游请求 identity 编码，抑制脚本的范围/条件请求；修改后重算内容长度并去掉过期校验头。响应保持 private/no-store。认证失败、应用数据流与 WebSocket 保持原有透传。响应头和有界纯元数据日志提供兼容状态，不记录 token 或会话内容。

## Alternatives considered

- **只等待上游发布。** 用户的真实 iPhone 体验会继续受影响。上游修复仍是兼容层退役路径，但用户已明确授权临时下游交付适配。
- **修改 `Function.prototype.toString`。** 这会改变所有已加载插件的全局行为，对无关消费者掩盖问题。定向脚本修改的行为范围更小。
- **修改宿主检出或 Session 私有对象。** 这违反宿主归属边界，并让移动端耦合内部服务生命周期。适配层不改变服务端执行，也不自行重建回复流。
- **刷新或轮询快照。** 无法解决 Safari 确定性的校验失败，还可能破坏流式连续性。原有宿主订阅继续作为唯一所有者。

## Consequences

只有经过此 ingress 的客户端得到适配，局域网直连和其他代理不受影响。正文订阅已停止的页面需要在适配生效后重新加载。未知/压缩构建、编码响应和超大 bundle 原样透传，必须另行验收，不自动扩大代码指纹范围。

本适配去除了已知触发原因，没有实现宿主 Session 失败状态加固。上游仍需补错误发布、清理/重试和一致的 cursor 发布。上游修复版本通过实际 WebKit 重连与进行中回复验收后移除开关。仅 Chromium 移动尺寸模拟不足以覆盖问题。单元测试覆盖准确/混合指纹、跨 realm 原型检查、字节长度、缓存条件、认证失败、超大文件和流式透传。
