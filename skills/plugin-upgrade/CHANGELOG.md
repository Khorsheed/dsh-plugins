# Changelog

## 0.2.0 (2026-08-31)

从插件包形态转为纯技能目录（经 capability-catalog 的 zip/GitHub 导入分发）；版本号从包版本迁到 frontmatter `metadata.version`。

累计的实测驱动改进（v1–v5 五轮实测）:

- 重启链：自分离 supervisor（怎么调用都安全）、升级成功自动为用户打开新 token 链接、健康检查认任意 HTTP 应答（0.1.2 token 门禁）
- 纪律：重启双锁（用户确认+supervisor 存活）、平等为准（升级不许静默降级）、分支前置（Phase 0 先建分支）、打包前强制 clean rebuild
- 验收：浏览器活体不可替代、验证信号强度匹配失败形态、终版报告发进会话并跟随用户语言
- 机制：分布式留言板（`$DSH_HOME/skill-feedback/`)、冻结 fixture 基准线（run-report v1 基线在 tests/e2e/)

## 0.1.0 (2026-08-30)

首个可用版本：六阶段升级 runbook + 断裂面清单 + 双线修复模式 + 重启 supervisor 资产。e2e 实测（rc.2 → 0.1.2-alpha.2）一句话自升级成功。
