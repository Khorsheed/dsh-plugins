# 变更记录

## 2026-09-10 —— 成员 0.2.0：适配宿主 0.1.2（先升宿主，再升插件）

- 10 个成员插件集体升到 0.2.0，适配宿主 0.1.2 线。这是一次不兼容升级：**请先把宿主升到 `0.1.2-rc.1` 或更新，再装 0.2.0 成员**；还在 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的宿主请继续用 0.1.x 成员（ankh-guard / file-preview 末版 0.1.1，其余末版 0.1.0），不要升级
- 「产物」预览里的「打开目录 / 在 IDE 打开」按钮在 0.1.2 宿主上暂时隐藏（宿主把这项能力改成了按需探测，恢复跟进中）；其余功能不变，另有一处提示音来源调整（阻塞提示改由官方会话服务驱动），听感不变

## 2026-08-24 —— 安装体验优化（人类/Agent 双指南）

- **人类/Agent 双安装指南**：有 agent 的用户一句话完成安装（"帮我装一下这个：<repo>")；无 agent 三条命令手动装。新增「给 Agent 的安装指南」：安装 → 离线自检 → 同端口交接 → 交付话术，安装成本从 ~17M token 降到 ~2M
- **同端口交接脚本** `scripts/restart-into-web-basic.sh`：走整合包自带 ankh-guard 的守卫通道（凭证 → restart 一次成型 → canary)，agent 在宿主内也能安全完成"停旧启新"；交接后实例即被 watchdog 监督，起不来自动回滚
- **依赖地板抬升**:ankh-guard / file-preview 最低 `^0.1.1`——整合包永远带上 skill 调用修复（0.1.0 的 skill 目录可见但调用即炸）
- 交付提示：交接后需硬刷页面（Cmd/Ctrl+Shift+R）加载新的 client bundle（产物 tab、任务胶囊等）

## 2026-08-22 —— 首个公开版本

dsh-web-basic 首个版本，包含 10 个成员插件：message-tools（消息编辑/撤回/恢复）、message-timeline（历史时间轴）、session-title-edit（标题内联编辑）、file-preview 对（产物预览）、taskpilot（后台任务胶囊）、context-guard（压缩提醒）、ui-shortcuts（自定义快捷键）、whalesong（状态氛围）、ankh-guard（运维守护）。

每个成员可单独卸载/加装，见 README「按你的方式调整」。
