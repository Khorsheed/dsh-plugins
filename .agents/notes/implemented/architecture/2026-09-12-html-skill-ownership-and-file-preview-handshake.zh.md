# Agent Note: HTML skill 归 inline-html-render 所有，file-preview UI 必须先完成宿主握手

Status: implemented

[English](2026-09-12-html-skill-ownership-and-file-preview-handshake.md) | 中文

## Problem

只读的 `@khorsheed/dsh-file-preview` 宿主注册了面向模型的 `3d-artifact` 作者策略，但生成 HTML 不属于其文件系统/会话预览职责。另一方面，挂载客户端 Remote 描述符并不能证明宿主 handler 存在：只有客户端的组合仍会公布「产物」tab、回合卡片和改动记录 renderer，最终只能失败或显示空内容。

## Decision

`3d-artifact` 现在分发于 `packages/inline-html-render/skills/3d-artifact/SKILL.md`。inline HTML owner 在 `ctx.inject(['skills'])` 就绪后与 `inline-html-card` 一起读取它，并以 `provider: 'inline-html-render'` 注册两个 runtime skill。只读 file-preview 宿主不再读取、分发或注册作者指导。本 Note 取代历史 [3d-artifact 注册 Note](../feature/2026-08-21-3d-artifact-skill-registration.md) 的归属决策；历史 Note 保持原样，继续记录当初的决定。

宿主 Remote 暴露零会话 `capabilities()` 方法，返回 `{ protocolVersion: 1 }`。浏览器 companion 挂载描述符后调用该方法；只有响应成功且协议版本为 1，才安装 locale、tab 类型/body、回合行、mention wrapper 和改动记录 renderer。`installFilePreviewSurfaces(ctx, remote)` 在探测之后统一拥有安装与卸载，测试可直接驱动这条边界。host-only、client-only 和 paired 三种组合分别固定。

## Alternatives considered

- **因为 file-preview 渲染已保存 HTML 而继续持有 skill**：拒绝；渲染与只读文件访问并不拥有模型作者策略，安装读取服务不应静默扩大模型行为。
- **发布第三个纯 skill 包**：拒绝；inline-html-render 已拥有 HTML 作者协议，也已有延迟 runtime-skill 注册生命周期。
- **把 `$mount` 成功当成宿主可用**：拒绝；它挂载的是客户端描述符，不是服务器 handler，这正是非对称安装缺陷的来源。
- **保留可见的不可用卡片或空 tab**：拒绝；受支持的宿主缺席应表现为所有依赖 UI 面缺席，也无需新增错误 locale。

## Consequences

- 安装 inline-html-render 现在会在同一 provider 下暴露两个 HTML 作者 skill；单装 file-preview 不再暴露作者 skill。
- 配对 Remote 新增带版本的零会话动词，未来协议不兼容时可保持缺席，而不是部分安装。
- 客户端启动会在注册 UI 前等待一次握手。宿主缺失、失败或不兼容都不留 UI 痕迹，已挂载描述符仍随客户端 fiber 卸载。
- tarball 覆盖随 skill 目录一起迁移，测试同时验证 catalog 注册与三种受支持安装形态。
