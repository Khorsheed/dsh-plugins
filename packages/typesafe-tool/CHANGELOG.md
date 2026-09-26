# 变更记录

## 0.1.1（2026-09-27）

- **修复 rc.1 挂载顺序下工具行静默惰死**：rc.1 的 preset registry 在自身 apply 时激活 standing scope，早于 profile 靠后 bundle 行的 core 提供；apply 里的一次性 `ctx.get('typesafe')` 探测看到 ABSENT 后提前返回，行已完成、再不会重跑——`typesafe_judge` 在所有 preset 里静默失效（官方插件清单仍显示已启用）。改为包级 `inject` 声明（`@khorsheed/dsh-typesafe` 核心服务）：行 pending 至 core 提供再激活（registry 审计展示 waiting 状态）；apply 内 `ctx.get` 守卫留作防御性直调路径
- README 同步 declared-inject 的 pending 语义；删除一张从未存在的凭据截图引用
- 随宿主 0.1.7-rc.2 基线发布波重发：全量构建+测试在 rc.2 基线通过

## 0.1.0（2026-09-26）

首个公开发布。
