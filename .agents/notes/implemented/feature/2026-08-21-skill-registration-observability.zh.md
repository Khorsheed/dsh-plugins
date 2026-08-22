# Agent Note: skill 注册可观测化(check-env 行 + 缺席告警)

Status: implemented

[English](2026-08-21-skill-registration-observability.md) | 中文

## 问题

一次宿主迁移（0.1.1-rc.1 适配）把随包的重启协议 skill 弄丢了，而且直到有人肉眼去看才被发现：单元测试、pack smoke、运行时降级告警守卫的都是仓库内部的包，而迁移重打包/改接线从不跑这些门禁。skill 缺席在任何地方都没有信号——可选消费模式（`ctx.get('skills')` 拿不到就静默跳过）让"能力消失"这种情况也完全不可见。

## 决策

- 每次 boot 把注册结果写入 `skill-registration.json`(`writeSkillRegistration`，原子、best-effort):`registered: true`，或 `false` 加原因（skills 服务缺席 / SKILL.md 损坏或不可读）。
- `check-env` 以 `skill:` 行输出——已注册 / 未注册（附原因）/ 无记录——与监管状态、启动命令并列，任何碰到这个部署的 agent 一次调用就能看到。
- 无 skills 服务的组合现在在启动日志告警，不再静默跳过。

## 考虑过但未选

- **更多仓库侧测试**——它们只守卫留在仓库内的代码；丢失恰好发生在那个边界之外。（配套的仓库侧门禁——`files` 必须覆盖每个运行时读取的目录——和迁移验收清单已交给 monorepo 维护者。)
- **CLI 直查活注册表**——CLI 跑在实例进程之外；boot 期的落盘记录是两侧唯一共享的通道。

## 后果

- `check-env` 输出新增一行；按位置解析它的脚本应改为按键名前缀匹配。
- 这个标记是可观测性设施，永远不是门禁：注册仍然降级而不是阻塞 boot。
