# 变更记录

monorepo 级别的发布摘要；各包的完整变更见 `packages/<包>/CHANGELOG.md`。

## 2026-09-10 —— 0.2.0 波：宿主 0.1.2 适配（BREAKING）

- 10 个已发布插件齐发 0.2.0：ankh-guard、context-guard、file-preview、message-timeline、message-tools、session-title-edit、taskpilot、ui-file-preview、ui-shortcuts、whalesong
- **BREAKING**：minHost 地板整体前移至宿主 `0.1.2-rc.1`（client-runtime 移除 / Session API 更名 / ui-primitives 强制 labels 等）；宿主 `0.1.0-rc.6` ~ `0.1.1-rc.2` 的用户停留在 0.1.x 线（ankh-guard / file-preview 末版 0.1.1，其余末版 0.1.0）
- 各包适配明细见各自 CHANGELOG：message-tools 走 `snapshotEvents` + `SessionSeq` 品牌化、whalesong blocked 铃改订阅 `uiSession.pendingInteractions`、message-timeline 改 `useChat` 单座席、ui-file-preview 的 external-open 按钮在 0.1.2 隐藏、taskpilot 历史 loader 走 `remote.session` follow/page 等
- ankh-guard 另携两项新能力随波发布：进程内 `requestRestart` 触发缝 + boot 代际浏览器刷新；preflight 快照跳过 socket/FIFO 与顶层 `scratch/`（home 快照不再因运行时条目拒绝，慢复制提前警告）

## 2026-08-27 —— local-agent 家族：设置卡片 + live 热切 + token 流式收尾

- **设置卡片**（提案 2026-08-26-local-agent-live-settings-card）：每个 provider 在 设置 → 插件 → 插件配置 自带一张卡片（认证 + live 开关 + 输出粒度，说明收 ⓘ 悬浮），live 切换即时生效、进行中的轮不打断；卡头状态点一眼可见授权状态。独立「本地 Agent」设置 tab 同步撤除（M3），认证管理全进卡片。
- **工具名对齐**：委派工具改为官方模型面向名 `subagent_codex` / `subagent_claude_code`（官方行出厂禁用，patch 加 disable 兜底）。
- **token 粒度流式收尾**：四家统一——settle 合成一条最终消息打在流式同 (turn, step)，无重复渲染、无悬挂「已停止」。
- **凭证可靠性**：kimi 凭证空壳哨兵（备份 + 自动恢复 + 归因日志）；claude 认证探测改为先同步 keychain 并认可 refresh token 有效期。
- **镜像修复**：四家折叠层全量 persistence append 撞 seq 契约导致 offset 不推进的问题全部修复。

## 2026-08-23 —— 补丁：ankh-guard / file-preview 0.1.1

- 修复随包 skill "目录可见、调用即炸"（宿主 load 时校验注册 `source` 字段，之前未传）；两包各发 0.1.1，附真实 SkillRegistry 往返测试

## 2026-08-22 —— 第一波：dsh-web-basic 成员首发

- 10 个插件首发 npm，统一 0.1.0：ankh-guard、context-guard、file-preview、ui-file-preview、message-tools、message-timeline、session-title-edit、taskpilot、ui-shortcuts、whalesong(message-tools 此前内部迭代至 0.4.x，公开线从 0.1.0 起）
- local-agent 家族（7 包）member-channel 适配收尾中，第二波整体发布
- datasets / lab / mission 为孵化中在途工作，不在发布线
