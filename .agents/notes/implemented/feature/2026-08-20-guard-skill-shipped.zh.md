# Agent Note: 重启协议随包成为 skill;boot 须知广播退役

Status: implemented

[English](2026-08-20-guard-skill-shipped.md) | 中文

## 问题

boot 须知在 agent 创建时向每个 root 会话注入"重启必须走守护 CLI"的消息——无条件、每次 boot 都注入。由于 agent 在重启后惰性重建，每个会话在每次重启后的首条消息都会再收一遍。广播存在的理由是：新机 agent 在引导真空里手写 `sleep/kill/nohup` 重启脚本，被实例 teardown 回收。但推送通道让每次重启都给所有会话制造噪音，而引导只有在任务真的涉及重启时才有意义。

新机首装测试同时展示了拉取通道的可行性：驱动 agent 通过 `dsh-self-restart-guard` skill 发现了协议——但那个 skill 住在开发机的用户级 `~/.agents/skills/` 里，不在包里，内容还硬编码了开发 monorepo 路径（`GUARD="node $HOME/code/dsh-plugins/..."`)。社区部署没有这个 skill；广播是它们唯一的会话内发现渠道。

## 决策

- skill 随包分发：`skills/dsh-self-restart-guard/SKILL.md`（已加入 `files`),apply 时经 `ctx.skills.register()` 注册（`src/index.ts` 的 `registerRestartSkill`)。catalog 在任务涉及重启时恰好浮现它——拉取替代推送。
- 删除 boot 须知（`ctx.on('agent/created')` 注入 + `bootNoticeText`)。重启后的 followup 不变：报告仍只唤醒发起会话，续跑消息仍只发给被中断的会话。其余会话现在完全无感。
- skill 内容通用化：CLI 从已安装包解析（`$DSH_HOME/profiles/*/node_modules/@khorsheed/dsh-ankh-guard/lib/cli.js`),monorepo 路径和特定宿主的逐命令提权名称都已移除。
- 注册是可选且防御性的：无 skill 能力的组合跳过（`ctx.get('skills'`));随包 SKILL.md 缺失/损坏降级为警告——发现辅助绝不允许拖垮 boot。pack smoke 测试负责断言该文件在 tarball 中存在。
- skills 注册表的 runtime 条目规则使同名冲突安全：runtime 条目优先于 user 条目；同名 runtime 重复注册是 first-wins 加警告，绝不报错。

## 考虑过但未选

- **保留广播但每会话终身一次**(state 目录持久化已投递集合）——保留了推送通道，其价值仅在首次接触发现，代价是永久的逐会话状态和文案变更时的版本问题。skill catalog 已经零状态地提供了首次接触发现，推送通道没有剩余职责。
- **skill 文本内嵌为源码字符串**——随包 markdown 文件让散文以标准 skill 格式可评审，且 pack smoke 能断言其存在；apply 时的一次性读取只有几 KB。

## 后果

- 无 skill 能力的组合（罕见的最小树）失去会话内发现；on-install 的 stdout 引导、CLI 动词的内联提示和 README 仍在。
- 用户自有的 `~/.agents/skills/dsh-self-restart-guard` 副本现在被随包 runtime skill 遮蔽（runtime 优先于 user)；删掉它是无害的清理。
- followup 唤醒语义刻意不动：发起者 + 被中断会话唤醒，其余无感——现在连注入都没有了。
