# Agent Note: 0.1.2 基线同步——client-runtime 移除，扫描器漏配包装器

Status: implemented

[English](2026-09-09-012-baseline-sync.md) | 中文

## Problem

`deepseek-harness` 发布了 `0.1.2-rc.1`（tag `dsh-v0.1.2-rc.1`，现为 npm `latest`）。该线移除了 `@deepseek-ai/dsh-client-runtime`，新增一批包（dsh-client-store、dsh-client-ui-chat、dsh-api-session-controller、dsh-api-workspace-controller、dsh-client-ui-session、dsh-util-values 等）。本仓已合并 0.1.2 源码适配分支，但所有依赖声明和基线文件还停在 `0.1.1-rc.2`，且有七个包仍用 devDep `link:` 把 `dsh-client-store`/`dsh-util-workspace-path` 链到旁边的 alpha 检出。

## Decision

只动基线——源码适配明确属于后续阶段，编译红是预期状态。

- **devDependencies 全量扫到 `^0.1.2-rc.1`**（26 个包，cordis 不动）。`dsh-client-runtime` 条目全删——devDeps，以及 `peerDependencies`/`peerDependenciesMeta`：留着 peer 会让 pnpm 自动安装最后一个已发布的 runtime（`0.1.0-rc.8`），进而把 `dsh-host-apiproxy@0.1.1-rc.2`（上游 0.1.2 已移除，0.1.1-rc.2 之后从未发布）拖进 lockfile。过时的 `link:../../../deepseek-harness-alpha/...` devDep（7 处 dsh-client-store、1 处 dsh-util-workspace-path）替换为 `^0.1.2-rc.1`——两个包现在都已发布。
- **按实际 import 补齐缺失声明**：8 个包的 client spec 从 `dsh-client-ui-renderer` 导入 `SlotRegistry`，已补 devDep；message-timeline 补 `dsh-client-store`；local-agent-tool-subagent 补 `dsh-system-prompt`。room 的 rc.6 线 devDep 和其他遗留（ankh-guard 的 `^0.1.0-rc.8` dsh-skill、local-agent 的 `^0.1.0-rc.6` dsh-subprocess）一并扫到同一条线。
- **`pnpm-workspace.yaml` 按 lockfile 重新生成**，不是手改：73 个 `@deepseek-ai/dsh-*` 包全部且恰好解析到 `0.1.2-rc.1`；`overrides` 与 `minimumReleaseAgeExclude` 是同一个 73 条集合。旧清单里的 `dsh-host-apiproxy` 移除（不存在 0.1.2-rc.1）；新增 14 条（dsh-client-store、dsh-client-ui-chat、dsh-client-ui-session、dsh-api-session-controller、dsh-api-workspace-controller、dsh-cmdline、dsh-code-runtime-worker-thread、dsh-mcp-client、dsh-deque、dsh-session-persistence-jsonl、dsh-util-crypto、dsh-util-time、dsh-util-values、dsh-util-workspace-path）。`allowBuilds` 不动。
- **`pnpm dedupe` 是必需步骤，不是可选。** 官方 0.1.2 包 peer 要 `@deepseek-ai/cordis@^4.0.2`，本仓声明 `^4.0.1`；依赖图里曾存在两个物理 cordis@4.0.1 实例（按 cordis-plugin-loader 1.0.2 对 1.0.3 分裂），于是模块增强（`declare module '@deepseek-ai/cordis'`）落在了插件代码没有导入的那份副本上——taskpilot 宿主面报 `Property 'agents' does not exist on type 'Context'`，尽管 `import type {}` 写法完全正确。dedupe 把 cordis 收敛成单实例后，taskpilot 宿主面编译通过。其客户端面保持有意为红：源码仍 import `@deepseek-ai/dsh-client-runtime/client`（类型迁往 dsh-client-store/dsh-client-ui-chat 是下一阶段）。`@deepseek-ai/dsh-compact` 仍未发布，但全仓已无引用——不是卡点。
- **CI 种子标签** `dsh-v0.1.1-rc.2` → `dsh-v0.1.2-rc.1`（gates job）；alpha-compat job 继续跟随 npm alpha tag。
- **gen-official-tools 扫描器按 rc.1 修正**:0.1.2 里 `send_message` 以 `ctx.tools.register(markAdjacentAgentSendMessageTool(defineTool({…})))` 注册，旧正则 `register(defineTool({` 看不见——重新生成的清单把它静默丢掉了。正则现在容忍标记包装器；rc.1 清单 41 个工具，与 0.1.1-rc.2 的差量：`+list_subagent_models`（且 `send_message` 正确保留；全清单无 `report`）。

## Alternatives considered

- **保留 `dsh-client-runtime` peer、容忍 lockfile 里的 0.1.1-rc.2 残留**——否决：任务的验收条件是 lockfile 零 `0.1.1-rc`，且对一个宿主已不再发布的包声明 peer 会把死插件装进消费者。
- **同一pass里顺带改写 `dsh.client.inject` 数组和 `dsh.compat.verifiedHost`**——有意推迟：每个客户端正确的 inject 集合取决于源码级迁移（runtime 导入的替代物是什么）,`verifiedHost` 也要等重新审计后才翻动。两者均已列入遗留清单。
- **不动 gen-official-tools 正则、手工把 `send_message` 加回清单**——否决：生成文件必须可重现，修扫描器才是持久解。

## Consequences

- `pnpm install` 重新生成的 lockfile 中 `0.1.1-rc` 出现 0 次；73 个官方 dsh 包全部单版本、单实例。
- 目前 `pnpm install` 会在 taskpilot 的 `prepare` 处非零退出（其客户端面构建在源码迁移落地前保持红）；任何触发 deps-status 检查的 pnpm script 都会撞同一堵墙——在那之前用 `--config.verifyDepsBeforeRun=false`。
- 留给适配阶段：`dsh.client.inject` 数组仍引用 `@deepseek-ai/dsh-client-runtime`（taskpilot 等）、各 package.json 的 `dsh.compat.verifiedHost` 仍是 `0.1.1-rc.2`、README Compatibility 重新审计，以及剩余 `dsh-client-runtime/client` 导入的源码迁移（重点是 taskpilot 客户端面）。
