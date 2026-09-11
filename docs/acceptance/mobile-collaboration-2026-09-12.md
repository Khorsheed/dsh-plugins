# Mobile collaboration 验收 — 2026-09-12

验收人：Codex · mobile 0.1.0 · 宿主：0.1.5-rc.1（183f08e9c6）。

## 环境

独立 worktree 构建，Node 22、pnpm 11、官方源码工具链。使用标准 pack-dist tarball 安装到 mobile 私有测试 profile；Host 3181、测试入口 3182、mock provider 3199。未修改官方或其他插件源码，未修改或重启生产 3080，未发布 npm 包。

可选插件：message-tools 0.3.0、TaskPilot 0.3.0、Room 0.1.0、local-agent / Codex provider / tool-subagent 0.1.0-rc.6、Claude Code provider 0.1.0-rc.5。tool-subagent 为依赖，不作为独立 bundle 注册。测试 provider 返回固定文本；测试 Room 有主 Agent 和一位未派发任务的 reviewer。

## 逐项结果

| 项 | 判据 | 结果与证据 |
|---|---|---|
| mobile 构建与测试 | 类型、打包、行为测试通过 | build 成功；13 个测试文件、52 项通过。覆盖原消息回调、Room 错误解包/成员配置/子会话导航、队列 steer 和提交后失焦。 |
| 可选插件构建与测试 | 参与安装的包均可构建 | message-tools 181、TaskPilot 48、Room 186、local-agent 224、Codex 165、Claude Code 153、tool-subagent 15 项测试通过。 |
| 浅色/深色窄屏布局 | 360、393、430 CSS px 无水平溢出 | 六组通过；Send 为 44×44，圆环在输入卡片内且位于 Send 左侧；模型按钮宽约 155/160/185 px。检查两种主题截图，文字与按钮边缘可辨。 |
| 提交后收起输入 | Host 接受后空编辑器失焦 | 实际测试 Host 提交：focused=false，draft 为空，无页面异常。原生键盘动画另列待验收。 |
| 用户消息长按 | 使用原 message-tools 动作 | 长按菜单的编辑打开原插件编辑框；不复制消息修改实现。 |
| 助手消息长按 | 只使用对应 assistant turn 的动作 | 实际页面菜单：复制、好的回答、有问题的回答、在新对话中分支；不出现用户编辑/撤回。未知消息结构保留原操作。 |
| Room 成员 | 显示真实成员并保存角色 | 实际显示 2 位成员；修改 reviewer 角色后 Host 保存成功；未创建 CLI 任务。子会话导航的准确 ID 调用通过行为测试，真实 CLI 子会话待认证验收。 |
| 目标与任务 | 保留插件胶囊 | 实际 Room 页面显示目标 0%、任务 0/1。TaskPilot 保留原 slot 渲染与回调；其完整运行周期未在手机验收。 |
| 排队立即发送 | 调用官方 updateQueue steer | 实际 Room 运行中提交第二条消息，面板显示立即发送/编辑/移除；点击立即发送无页面异常。行为测试确认准确 queue ID 与 steer 请求、不提前移除队列。含附件消息保留附件，移动面板不提供纯文本编辑。 |
| 桌面布局返回 | 恢复原布局并能回到 mobile | 实际切换后 mobile 折叠标记清除，返回按钮可重新打开移动布局，无页面异常。 |
| 独立卸载/重装 | Host 与其他插件仍可使用 | 从测试 profile 移除 mobile bundle/依赖并重启 3181：mobile UI 标记为 0，官方模型输入入口正常，Room Remote 返回原来的 2 位成员，无页面异常。恢复 tarball 后重新通过六组布局与长按检查。 |

## 待验收与限制

- 测试环境的 Codex、Claude Code 认证均未就绪；邀请页显示需在电脑登录。未借用生产凭据，未将 mock 回答作为真实 CLI 协作证据。
- iPhone 上的键盘收起、长按与系统选词的手势协调、玻璃材质观感，需要用户真机复测；浏览器检查不能替代这些项目。
- TaskPilot 完整任务生命周期、实际 local-agent 子会话打开与返回、断网恢复期间的 Room 成员变化，仍需真实协作场景验收。
- Room 首次异步缓存填充未主动刷新 composer 选举；mobile 以始终拒绝接管的公开 slot entry 触发重新选举，原插件决定最终 composer。此兼容层在 Room 修复自身通知后移除。
- 本次不构成生产发布验收。未来 mobile 整合包的成员方案已写入 Agent Note，未修改现有整合包，也未创建社区发布版本。
