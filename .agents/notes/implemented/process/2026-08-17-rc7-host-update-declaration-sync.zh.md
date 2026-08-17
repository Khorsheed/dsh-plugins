# Agent Note: rc.7 宿主升级 + 依赖声明同步

Status: implemented

English | [中文](2026-08-17-rc7-host-update-declaration-sync.zh.md)

## 问题

`deepseek-harness` 发布了 `0.1.0-rc.7`(2026-08-17,发布合并 `bb4ca698d6`)。部署 checkout 和所有插件的声明仍停留在 rc.6 线,且有两处过期范围会在 rc.7 线之外安装宿主包的第二个副本:`local-agent-kimi` 硬依赖 `@deepseek-ai/dsh-home-paths ^0.0.1-rc.3`(未使用的依赖,范围不含 0.1.0 线),`file-preview` 的 devDependencies 用 `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-loader-smoke ^0.0.1-rc.1`(测试对着 0.1.0 之前的类型编译)。

## 决定

- **部署仓库**(`~/code/deepseek-harness`):guard checkpoint `962169d37f`(消息 `pre-rc7-deploy-update`)、备份分支 `deploy-pre-rc7`,然后硬重置到上游 master `99f6f02fec`(rc.7 发布合并)。225 个本地 checkpoint 提交现在只存在于 `deploy-pre-rc7`。3080 经 `schedule-exit` 重启;watchdog canary PASS,服务的图里 8 个客户端插件包齐全。
- **纯净镜像**(`~/code/deepseek-harness-mirror`):全新 clone 上游 master 于 rc.7 + `pnpm install` + `build:lib:host`,保持纯净,作为跟踪/测试 checkout(候选 `DSH_HARNESS` 种子),与受 guard 保护的部署 checkout 分开。
- **声明**:peer/dev 范围保持在宽 caret 线 `^0.1.0-rc.6`(覆盖 rc.7 及后续 0.1.0-x,AGENTS.md 惯例),`dsh.compat.minHost` 保持在 `0.1.0-rc.6`(已验证下限——插件在 rc.6 上跑了一周;minHost 是下限不是当前线)。README Compatibility 段(中英)统一更新为 rc.7 线作为已验证结论。早期一次过度修正把范围与 minHost 升到了 `0.1.0-rc.7`,并因全局替换误伤了四个包自己的 `version` 字段(ankh-guard `0.1.0-rc.6.6`、taskpilot/message-timeline/session-title-edit `0.1.0-rc.6`)——已全部还原;version 是发布线,不能跟宿主线走。真正保留的清理:`local-agent-kimi` 未使用的 `dsh-home-paths ^0.0.1-rc.3` 硬依赖删除、`file-preview` 的 `dsh-llm`/`dsh-loader-smoke` devDeps 脱离 `^0.0.1-rc.1` 并入 `^0.1.0-rc.6`、lockfile 刷新(解析到 `0.1.0-rc.7`,0.1.0 之前的第二副本清零)。
- **结论按 rc.6→rc.7 源码 diff 复检**(未逐 tarball 重跑):我们依赖的集合只有增量/内部改动——`dsh-llm` 把 `replayState` 收窄为 `ReplayEnvelope`(我们没有任何 import 用它)、`dsh-tools` 仅提示文案、`ui-conversation` 内部 Safari 修复、`ui-primitives` 增量导出、slot-catalog 唯一改动(`settings.plugin.item` list→keyed)我们未使用。所有 ✅ 结论在 rc.7 上成立。

## 备选方案

- **保留 `^0.1.0-rc.6`**——语义上满足 rc.7,但声明停留在旧线,且第二个副本的问题不可见;lockfile 里已经能看到 `dsh-home-paths@0.0.1-rc.3` 与 `dsh-llm@0.0.1-rc.1` 和 rc.6 实例并存。
- **就地补丁部署仓库**——拒绝:受 guard 保护的 checkout 按设计是可弃置的(AGENTS.md),上游纯净重置 + 备份分支才是预期的更新路径。

## 后果

- guard 凭证 `build+test` 已记录在 `99f6f02fec`,带一条如实注明的例外:4 次全量测试各有 1–2 个时序敏感用例失败(`user-patches.spec.ts` HMR watcher 3 次、`process-exit.spec.ts` 1 次),单独跑全部确定性通过——这是这台 macOS 全量套件下的环境级 flaky,不是 rc.7 缺陷(同一提交上游 CI 全绿)。
- **组合 preflight 门禁已无 fork 补丁重建**:`packages/ankh-guard/src/preflight-runner.ts` 通过动态 import 从在线 harness checkout 加载官方已发布包(`@deepseek-ai/dsh-app-boot`/`dsh-home-paths`/`dsh-launch-environment`/`dsh-cmdline`,monorepo 布局映射 `packages/<category>/<name>`,harness 根取自 `--repo`/`DSH_HARNESS`/默认 `~/code/deepseek-harness`),把 webserver 端口钉到 0,boot 整棵插件树,检查每个已注册 client bundle 产物存在,dispose,退出码 0/1/3。guard CLI 的 `preflight` 命令与 `schedule-exit`/`restart` 门禁优先走 runner(解析顺序:`DSH_PREFLIGHT_COMMAND` override → runner → fork `dsh preflight`)。这能扛住上游发布——不修改 apps/cli,rc.8 抹不掉它;只依赖已发布 API 面保持稳定(兼容性审计的职责)。npm 线(独立安装无 checkout)仍降级为提示。
- profile 的 tarball 安装(`message-tools`、`taskpilot`)仍引用清理前的 tarball;刷新属于下一次发布周期。
