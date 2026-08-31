# plugin-upgrade 技能

[English](README.en.md) | 中文

宿主升级自引导技能。装进实例后,对 agent 说一句"把这个实例升级到 0.1.2",它就能按 runbook 自主完成:**拉新宿主到独立检出 → 盘点插件断裂面 → 双线兼容修复 → 活体验证 → 安全自我重启并恢复会话**。

这是一个**纯技能目录**,不是插件包:内容即全部,没有任何运行时代码。分发走 capability-catalog 的技能导入,或直接落进宿主技能目录。

## 安装

任选其一:

- **capability-catalog 导入(推荐)**:实例装了 `@khorsheed/dsh-capability-catalog` 时,把本目录打成 zip(带包裹目录、`tests/` 除外,例如 `zip -r plugin-upgrade.zip plugin-upgrade -x 'plugin-upgrade/tests/*'`),在 catalog 设置页「添加技能」上传,或用它的 add-skill 工具/Remote 传入。GitHub 导入同理可用。
- **直接落盘**:把本目录(不含 `tests/`)复制到 `$DSH_HOME/skills/plugin-upgrade/`(用户级)或项目的 `.agents/skills/`。

## 内容

- `SKILL.md` —— runbook 本体:铁律 → 基线 → 取新宿主 → 断裂面盘点 → 双线修复纪律 → 验证阶梯 → 自我重启(ankh-guard 守卫路径 / 手工 supervisor 路径)→ 舰队核验 → 终版报告 → 失败兜底 → 留言板。
- `reference/breakage-checklist.md` —— 断裂面清单(13 面 + 编译期盲区);`reference/dual-host-fix-patterns.md` —— 双线修复模式目录。
- `assets/` —— 可执行资产:`scan-plugin.mjs`(断裂面机械扫描,Phase 2 先跑它)、`trial-boot.mjs`(试启动新宿主)、`restart-resume.mjs`(自我重启 supervisor,自分离,全平台)。
- `tests/` —— 开发资产(自升级 e2e 装置 + run-report 口径),**不进 zip**。

## Compatibility

技能内容是流程指导,与宿主版本弱耦合;已验证线:0.1.1-rc.2 → 0.1.2-alpha.2 实跑一次通过(见 `tests/e2e/run-report.v1.baseline.json`)。资产脚本依赖 node(catalog 目标实例必有)。

## Known limitations

- skill 是**流程指导**,不替代判断:它把方法论、扫描器和监督脚本交给 agent,具体的迁移映射表仍由 agent 按目标版本现场生成。
- 无守卫重启后,在途回合会停在被中断处,需要用户重开会话推一下(见 SKILL.md Phase 5)。
