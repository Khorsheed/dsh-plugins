# Mobile 首次部署到 3080 — 2026-09-12

用户授权合并 main、部署生产并重启；确认没有不可中断的运行任务。

## 交付与边界

- mobile 0.1.0 与 iOS 外壳合并到本地 main；宿主为 0.1.5-rc.1（183f08e9c6）。未推送远端或发布 npm。
- 通过官方 `plugin add` 首次登记 mobile bundle，然后运行 `deploy:3080 --package packages/mobile --no-restart`。其余生产插件依赖保持原值。
- 通过 ankh-guard `reconfigure` 增加当前 Tunnel 的 trusted host，并完成生产守护进程交接。预检、认证交换及新 listener 归属验证通过，cutover 为 `ready`。
- HTTPS ingress 从 3181 改为 3080，公网域名保持不变。宿主继续监听 loopback，认证继续由宿主负责；未登录入口返回 401，跨来源请求返回 403。
- 3181 的固定答案来自模拟模型；生产验收不使用该模拟服务。手机通过原生外壳已有的认证启动入口切换到生产，无需重新安装 App。

## 验证证据

- 合并前完整 `pnpm gate` 通过，11 步、582 秒；最终 main 新增的并发变化仅为文档，补查 hygiene 与翻译配对通过。
- 部署时 mobile 构建与 58 项测试通过。生产组合预检通过；候选启动命令及隔离生产快照检查通过。
- 公网 HTTPS 下实际创建开发模式会话，通过官方 prompt 与 WebSocket follow 通道请求计算 `19×23`。收到 84 个 assistant stream chunk 帧，最终文字为“19×23 等于 437，这是手机连接真实模型验收的一次纯计算回复。”
- Room 的原 `listProviders` 返回 Kimi Code、Codex、Claude Code、dsh，均为已认证；未修改认证配置，也未重新登录。
- iOS 真机启动成功，进程存在。发送后键盘、长按、系统文字缩放等体验仍以真机反馈为准。

## 运维清理

隔离快照暴露了历史生成目录里的失效符号链接。仅清理已确认无法解析、且已保存路径和目标备份的生成链接：宿主旧 landlock-run 目录及生产 profiles 的历史依赖投影。未修改宿主源码、会话数据或凭据；不绕过守护预检。

## 今晚体验与限制

- 邀请 CLI 成员请选择包含 Room 能力的“开发模式”。标准模式保持原有 preset 门控，不由 mobile 擅自放开。
- 真实模型与公网流式链路已验证；上述 CLI 的完整任务派发、成员子会话往返、TaskPilot 生命周期尚未作为本次验收通过项。
- 当前仍为 Quick Tunnel 测试连接。保持电脑、3080 和 Tunnel 进程运行；公网稳定性与后台恢复继续收集实际使用反馈。
- 日志、认证 URL、cookie 和设备截图仅保存在忽略的本地调试目录，不进入仓库。
