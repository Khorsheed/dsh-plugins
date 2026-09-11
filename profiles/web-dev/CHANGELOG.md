# Changelog

## Unreleased

- 首个版本：21 个成员的开发模式 profile（基础体验 12 + 开发能力 8 + 运维守护 1）。
- 同端口交接脚本 `restart-into-web-dev.sh`，走 ankh-guard 守卫通道。
- 成员清单以「已合 main 且 3080 验收过」为准；`mission` 待上 3080 后加入。
- M4'③：mission / datasets / eval 拆成 core + companion（core 不再注册模型工具与提示词段）。**开发模式 preset 刻意不引用这三条伴生行**：三个 core 不在本 pack 的成员清单里（孵化中），而伴生包运行时要 import core 的 `./tool` 工厂——缺行会让整个 dev preset 报 broken。等它们上架、并加进 `package.json` 的 dependencies 之后再补三行；本 pack 的 dev preset 现在与拆分前逐字等价。
- 首版不自带 agent preset，使用官方 `standard`——preset 无 patch 语义，复制即快照漂移，差异化需求明确后再做。
