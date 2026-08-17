# Agent Note: rc.7 宿主升级 + 依赖声明同步

Status: implemented

English | [中文](2026-08-17-rc7-host-update-declaration-sync.zh.md)

## 问题

`deepseek-harness` 发布了 `0.1.0-rc.7`(2026-08-17,发布合并 `bb4ca698d6`)。部署 checkout 和所有插件的声明仍停留在 rc.6 线,且有两处过期范围会在 rc.7 线之外安装宿主包的第二个副本:`local-agent-kimi` 硬依赖 `@deepseek-ai/dsh-home-paths ^0.0.1-rc.3`(未使用的依赖,范围不含 0.1.0 线),`file-preview` 的 devDependencies 用 `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-loader-smoke ^0.0.1-rc.1`(测试对着 0.1.0 之前的类型编译)。

## 决定

- **部署仓库**(`~/code/deepseek-harness`):guard checkpoint `962169d37f`(消息 `pre-rc7-deploy-update`)、备份分支 `deploy-pre-rc7`,然后硬重置到上游 master `99f6f02fec`(rc.7 发布合并)。225 个本地 checkpoint 提交现在只存在于 `deploy-pre-rc7`。3080 经 `schedule-exit` 重启;watchdog canary PASS,服务的图里 8 个客户端插件包齐全。
- **纯净镜像**(`~/code/deepseek-harness-mirror`):全新 clone 上游 master 于 rc.7 + `pnpm install` + `build:lib:host`,保持纯净,作为跟踪/测试 checkout(候选 `DSH_HARNESS` 种子),与受 guard 保护的部署 checkout 分开。
- **声明**:全部 14 个包的 `@deepseek-ai/dsh-* ^0.1.0-rc.6` peer/dev 范围和 `dsh.compat.minHost` 升到 `0.1.0-rc.7`;删除 `local-agent-kimi` 未使用的 `dsh-home-paths` 硬依赖;`file-preview` devDeps 升到 `^0.1.0-rc.7`。README Compatibility 段(中英)统一更新到 rc.7 线。
- **结论按 rc.6→rc.7 源码 diff 复检**(未逐 tarball 重跑):我们依赖的集合只有增量/内部改动——`dsh-llm` 把 `replayState` 收窄为 `ReplayEnvelope`(我们没有任何 import 用它)、`dsh-tools` 仅提示文案、`ui-conversation` 内部 Safari 修复、`ui-primitives` 增量导出、slot-catalog 唯一改动(`settings.plugin.item` list→keyed)我们未使用。所有 ✅ 结论在 rc.7 上成立。

## 备选方案

- **保留 `^0.1.0-rc.6`**——语义上满足 rc.7,但声明停留在旧线,且第二个副本的问题不可见;lockfile 里已经能看到 `dsh-home-paths@0.0.1-rc.3` 与 `dsh-llm@0.0.1-rc.1` 和 rc.6 实例并存。
- **就地补丁部署仓库**——拒绝:受 guard 保护的 checkout 按设计是可弃置的(AGENTS.md),上游纯净重置 + 备份分支才是预期的更新路径。

## 后果

- guard 凭证 `build+test` 已记录在 `99f6f02fec`,带一条如实注明的例外:4 次全量测试各有 1–2 个时序敏感用例失败(`user-patches.spec.ts` HMR watcher 3 次、`process-exit.spec.ts` 1 次),单独跑全部确定性通过——这是这台 macOS 全量套件下的环境级 flaky,不是 rc.7 缺陷(同一提交上游 CI 全绿)。
- fork 的 `dsh preflight` 组合门**没有**带到 rc.7(它是本地补丁,被上游重置抹掉,仍保留在 `deploy-pre-rc7`);当前重启门降级为 "unavailable"(guard CLI 在 dsh-plugins,无法解析 sibling app)。是否重新应用是单独的跟踪决定——见 2026-08-17 preflight 补丁评估。
- profile 的 tarball 安装(`message-tools`、`taskpilot`)仍引用清理前的 tarball;刷新属于下一次发布周期。
