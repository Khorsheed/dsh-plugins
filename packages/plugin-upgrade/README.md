# @khorsheed/dsh-plugin-upgrade

[English](README.en.md) | 中文

宿主升级自引导 skill 包。装进实例后,对 agent 说一句"把这个实例升级到 0.1.2",它就能按 runbook 自主完成:**拉新宿主到独立检出 → 盘点插件断裂面 → 双线兼容修复 → 活体验证 → 安全自我重启并恢复会话**。

## 形态

skill-only 轻包:host 侧只做一件事——把 `plugin-upgrade` skill(含参考文档与重启 supervisor 脚本模板)注册进 skill 目录,agent 在任务涉及升级时通过目录**拉取**到它。无 client 面、无配置项、无持久状态。

skill 内容骨架(完整内容见 `skills/plugin-upgrade/SKILL.md`):

- **铁律**:绝不直接改运行中的宿主检出;特性探测而非版本号判断;typecheck 绿 ≠ 运行时干净。
- **断裂面盘点**:外化依赖/模块种子表、slots、Remote、settings、skills、命令签名、DOM 锚点、prompt order 锚点,以及"命名导出删除时类型仍绿"的编译期盲区。
- **修复纪律**:双 seat 探测、品牌类型锚定到消费方 API、删除包值导入内联(前提是无跨界身份)、降级不炸。
- **验证阶梯**:包级 → 组合级 → 活体验收(全新 HOME + 浏览器 console 零插件错误)→ 交付级(从零按 README 安装)。
- **自我重启**:有 ankh-guard 走守卫重启;没有则先写交接便签,再 spawn 全分离 supervisor(`skills/plugin-upgrade/assets/restart-resume.sh`:等旧进程死 → 起新宿主 → 健康检查 → 失败回滚旧检出)。
- **失败兜底**:任何一步不过就停下报告;重启失败由 supervisor 回滚。

## 安装

```sh
dsh plugin --profile <p> add @khorsheed/dsh-plugin-upgrade      # 安装(自挂载)
dsh plugin --profile <p> remove @khorsheed/dsh-plugin-upgrade   # 卸载
```

## Compatibility

- npm release line(`@deepseek-ai/dsh@0.1.1-rc.2`): ✅ full — 仅消费 skills registry(`ctx.inject(['skills'])` 等待式注册),该面在本审计窗口内无变化。
- Source line(deepseek-harness master): ✅

## Known limitations

- 无 `skills` 能力的极简组合里 skill 不注册(插件不报错,仅少一项发现渠道)。
- skill 是**流程指导**,不替代判断:它把方法论和监督脚本交给 agent,具体的迁移映射表仍由 agent 按目标版本现场生成。
