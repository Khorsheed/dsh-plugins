# Agent Note: local-agent 家族的委派工具折进各 provider 的 `./tool` 组合入口

Status: implemented

## Problem

家族的委派工具此前装在一个共享伴生包里——`@khorsheed/dsh-local-agent-tool-subagent`：同一个模块在 profile 根挂三次（每个 CLI provider 一次，各带 `provider`/`toolName` 配置），外加 local-agent-dsh 设置开关的第四个动态挂载。两类成本一直在累积：

1. **一个 provider 占两张卡的行数。** 每个 provider 的 bundle patch 既插 provider 行又插点名共享包的工具行，bundle-local-agent 再逐字复挂这个并集——插件清单里工具行和它所属于的 provider 是分开展示的；每一层组合（provider patch、家族 bundle、dev 预设、web-eval 覆盖）都重复同样三行。
2. **profile 根挂载让按会话授予失效。** 根行对所有会话授予；评测部署只能靠 `tools: none` 覆盖行封口（这个配置开关存在的唯一理由就是那道封口），而 dev 预设里那三行又是对 provider patch 已挂内容的冗余复制。

worktrees 0.3.0 与 room 0.2.0 的折叠已经验证了目标形态：工具行作为 `./tool` 子路径组合入口随包发布，agent 预设点名即按会话授予。

## Decision

2026-09-30 的家族折叠，分四步：

1. **工厂迁入家族核**，成为 `@khorsheed/dsh-local-agent` 的 `./tool-factory` 导出（`packages/local-agent/src/tool-factory.ts`）：`mountSubagentDelegationTool(ctx, config, owner)`、`subagentToolConfigSchema(provider, toolName)` schema 助手、`SubagentToolConfig`、`RESUME_HINT_PREFIX`。工具来源标签的 `owner` 改为显式**参数**，由调用入口传自己的 `PACKAGE_NAME`——共享模块不硬编码任何包名（AGENTS.md § Tool origin tagging）。`tools: all | none` 配置开关**删除**：它唯一的消费者是 web-eval 的 profile 根封口，而折叠让封口不再必要（没有任何预设点名即缺席，这就是封口）。
2. **每个 CLI provider 增加自己的 `./tool` 组合入口**（`packages/local-agent-{kimi,codex,claude-code}/src/tool.ts`）：`name` / `inject = ['tools', 'subagents', 'localAgent']` / Config 全部字段可选、默认即该 provider 自己的 `provider`/`toolName` / `apply` 委托给工厂。声明式 `localAgent` inject 让行在 profile 的 core 行提供之前保持 pending（2026-09-27 的启动顺序教训）。provider patch 自此恰好挂载一行——provider 自己；codex/claude-code 的 patch 保留对官方 `tool-subagent-codex` / `tool-subagent-claude-code` 行的裸停用（家族沿用这两个模型侧名字）。
3. **组合改指，行 id 不变。** dev 预设（`packages/presets/cordis.patch.yml` 与 `profiles/dev/presets/dev/agent.cordis.yml` 两处）以同样的行 id（`tool-subagent-kimi`、`tool-subagent-codex-local`、`tool-subagent-claude-code-local`）点名 `@khorsheed/dsh-local-agent-{kimi,codex,claude-code}/tool`，不带 config，组合状态不受影响。bundle-local-agent 撤掉三条工具行（仍是成员行的精确并集），退役包从其依赖中移除。web-eval 直接删掉三行 `tools: none` 覆盖——eval 预设不点名任何 `./tool` 行即是封口。
4. **`@khorsheed/dsh-local-agent-tool-subagent` 整体退役**——不留作 deps-only 库：包目录删除（room-tool/worktrees-tool 的惯例），名字进 `scripts/retired-packages.ts`（check-profile-bundles 自此拒绝任何引用它的仓内组合），local-agent-dsh 由开关持有的 `subagent_dsh` 动态挂载改经同一工厂（内联插件对象，owner 为 `@khorsheed/dsh-local-agent-dsh`）。

版本：家族六包同版推进到 `0.2.0-rc.1`（release-group 的同版线，同时吸收 local-agent-dsh 的 rc.9 偏移），bundle-local-agent 到 `0.2.0`，presets 到 `0.3.0`。

## Alternatives considered

**折进 CORE 自己的 `./tool` 入口（一行共享行，`provider` 仍是必填 config）。** 这是 2026-09-12 分解评审（docs/acceptance/plugin-decomposition-review-A-round2-2026-09-12.md）当时的裁定——边界一致性压过少一个发布单元。如今它落选的理由正是维护者定下的方向：core 持有的行永远无法自默认 `provider`（core 服务四家 provider），每条预设行仍要带 config，而「一个 provider 一张卡」的目标仍会在 profile 根或清单里漏出一条单独的工具行。按 provider 各开入口让预设行免配置，并把工具的所有权放回 provider 所在之处。

**共享包降级为 deps-only 库保留（自己不挂行，provider  import 它）。** 否决：这个包仍是一个发布单元，带着 invariant 伴生、双语 README 与 release-group 席位，而它的全部内容只是一个模块——折叠的意义恰恰在于工厂是家族内部代码，而家族内部共享代码本就住在 core 包里（member bridge、settings face、live stream 都是）。

**为对称保留 `tools: all | none`（对齐 datasets/mission 的工具分组）。** 否决：那里的分组存在是因为一行注册十几个工具；本入口恰好注册一个，不想授予的预设不点名即可。预设层的休眠行配置是没有消费者的开关。

## Consequences

- 每一层都变成「一个 provider = 一行 = 一张卡」；家族 bundle patch 收缩为成员并集，插件清单不再把工具行当作独立条目展示。
- 评测部署的封口变成结构性的：没有 `tools: none` 覆盖行、没有要保持同步的 config——工具缺席仅仅因为 eval 预设不点名。`subagent_dsh` 仍是写明在案的例外（开关驱动的动态挂载，默认 OFF）。
- 工具来源的 owner 归属从退役的共享包移到各 provider 包（`subagent_dsh` 归 local-agent-dsh），capability catalog 因此把工具归属到用户实际管理的那张卡。
- 家族六包同进 `0.2.0-rc.1`；退役名的 npm 弃标留给发布波，与此前两次折叠相同。
- check-plugin-independence 的 `NO_OWN_PATCH`/`ALLOWED_EDGES` 与 check-release-groups 的家族名册删掉退役包；其 spec 夹具改到折叠后的形态，行 id 与家族并集规则照常钉住。

## Testing

退役包的测试随工厂迁到 `packages/local-agent/tests/tool-factory.spec.ts`（挂载/卸载生命周期、resume 句柄解析与拒绝、registry 停止杠杆、调用方传入的来源标签），三个 `tools: none` 用例随开关一并删除。各 provider 的 `patch.spec.ts` 钉住单行 patch 与退役名的缺席；presets spec 钉住免配置的新 `./tool` 行（行 id 不变）；bundle spec 重新从成员并集推导。门禁：完整 `pnpm run build` 与触及包的测试、`pnpm check:plugins`、`pnpm check:profiles`、`pnpm test:scripts`、`pnpm check:hygiene`。

## Related

- 本次遵循的折叠模式：worktrees 0.3.0 / room 0.2.0（提交 `7a0e1541`），再上溯是 canvas 的 `./agent` 先例。
- `inject` 声明所编码的启动顺序教训：[preset 工具行把核心服务声明为 inject](../bug-fix/2026-09-27-preset-tool-rows-declared-core-inject.zh.md)。
- 被替换的封口：web-eval 的 `tools: none` 开关（T27），见 profiles/web-eval/docs/iterations.md 与 [eval 预设 note](../process/2026-09-08-web-eval-agent-preset.zh.md)。
