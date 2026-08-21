# Agent Note: pack-dist 展开 files glob——打包的 skill 真正进包

Status: implemented

[English](2026-08-21-pack-dist-glob-shipping.md) | 中文

## 问题

`scripts/pack-dist.ts` 的 `filesDeclaredExtras` 显式**跳过 `files` 字段里的所有 glob 条目**，注释还停留在"没有包会 glob 别的东西"。file-preview 的 `skills/**/*.md`（3d-artifact skill）——以及 ankh-guard 同形态的重启 skill——恰恰就是 glob。`pnpm pack` 会遵守它们，所以 pack-smoke 测试全过；但 deploy 路径（`deploy:3080` → `scripts/pack-dist.ts`）只暂存字面 extras + `lib/`，发布的 tarball 丢了 skill 文件。M1/M2 第一轮部署后，3080 生产 profile 里只有注册代码、没有 `skills/3d-artifact/SKILL.md`——注册降级为告警，skill 从未进目录。

## 决策

`filesDeclaredExtras(files, packageDir?)` 现在在给定 packageDir 时对 `dir` 双星 glob 做展开——递归后缀匹配（`<dir>/**/*.ext`）与全文件（`<dir>/**/*`），即实际在用的两种形态；字面 extras 行为不变，未给 dir 时 glob 仍跳过（保持纯函数语义，spec 已更新）。复制循环本就建父目录，展开文件正确入暂存。

## 备选方案

- **pack-dist 改走 `pnpm pack`**：否决——pack-dist 的职责是改写 manifest 作用域与载荷里的自名/家族名；`pnpm pack` 会跑 `prepare` 且名字不对。
- **在 `files` 里逐条枚举 skill 文件**：否决——glob 是包惯例；随 skill 增删会漂移，且与 `pnpm pack` 的行为分叉。

## 后果

- 3d-artifact skill 进 tarball 并在生产注册（已验证：重部署后 3080 profile 含 `skills/3d-artifact/SKILL.md`，运行实例技能目录可见，boot 无告警）。ankh-guard 的重启 skill 有同样的潜在缺口，本次一并修复。
- 任何经 pack-dist 打包 skill/脚本 glob 的包现在都能带上；过时注释已删。
- 迁移方打包 dsh 插件时应重新核验 tarball（`tar -tzf`）里 glob 声明的载荷。
