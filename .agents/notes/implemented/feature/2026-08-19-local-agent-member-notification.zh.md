# Agent Note: local-agent 成员互通知 —— 桥接 MCP + token 鉴权 + 闸门交接（M3）

Status: implemented

[English](2026-08-19-local-agent-member-notification.md) | 中文

## Problem

同一委派组（一个 room，或主 agent 的并行委派）的成员之间此前无法互相触达：CLI 成员在 run 中无法通知同组兄弟成员，任何跨成员知会都要人来转达。本 note 记录[成员通道提案](../../../proposals/active/2026-08-19-local-agent-member-channel.md)的里程碑 M3：成员 A 在 run 中调用 `member_message(to, text)` 工具；宿主以异步单向交接投递给成员 B（A 不等 B），并经**闸门交接**保持闸门所有权单一——room 在场归 room，缺席归家族。M1/M2（gateway remote 与可写 composer）记录于[成员通道 note](2026-08-19-local-agent-member-channel.md)；本 note 覆盖 M3 这个独立的决策集（桥接传输、token 鉴权、闸门契约）。

## Decision

**桥接 MCP server**（`packages/local-agent/src/member-bridge.ts`，构建为 `lib/member-bridge.js`，并登记为包 bin `dsh-local-agent-member-bridge`）。依赖树中不存在任何 MCP SDK（harness 的 `packages/mcp` 是宿主侧 client），因此桥接手写为无依赖的 stdio JSON-RPC server——换行分隔（NDJSON）帧，恰好覆盖 `initialize` / `notifications/initialized` / `ping` / `tools/list` / `tools/call` 子集——只暴露一个工具 `member_message(to, text)`。每次调用是对宿主 loopback listener 的一趟 NDJSON 往返；宿主的回执原样作为工具结果，通道级失败映射为 MCP 工具错误（`isError`）。

**宿主侧**（`packages/local-agent/src/member-channel.ts`）：`MemberChannel` 持有只绑 loopback 的 unix socket listener（`<homesRoot>/member-bridge.sock`），由插件 `apply` 挂载、随 fiber 销毁；绑定失败降级为通道缺席（告警，绝不抛错）。投递链：token → 已登记 run（发送方身份，绝不自报）**并与 spawn 出的 CLI pid 交叉校验**（桥上报其 `process.ppid`）→ 解析 B（`to` 为子会话 id；成员名只经认领的 room 花名册解析）→ 同父校验 → 闸门交接 → 家族直发。

**token 生命周期**（registry）：`registerMemberRun` 在 spawn 前铸造每 run 一次性 token（fresh 与 resume 轮同样），`bindMemberRunPid` 在 spawn 后随即绑定 CLI pid，`unregisterMemberRun` 在任意 settle 路径失效。未知/失效 token 或异源 pid → 工具错误，别无其他。

**鸭子类型的 room 闸门**——room 实现以持有派发闸门的契约，经 `ctx.get('room')` 探针加 `typeof` 检查发现，不 import 任何 room 包（independence checker 因此无需新 sanction）：

```ts
receiveMemberMessage(message: LocalAgentMemberMessage): Promise<RoomMemberMessageResult>
// { claimed: true, receipt } —— room 持有派发；回执原样透传给 A
// { claimed: false }         —— 父会话非本 room 实例管理；家族直发
```

`LocalAgentMemberMessage` 为 `{ from: LocalAgentDelegationView, to, content, parentSessionId }`。抛错的闸门记日志并视为拒绝。家族侧回执：`sent` / `busy`（B 的 resume 锁占用）/ `error: <原因>`（如父会话不在线）。直发 prompt 带出处标注（`成员 <harness>（会话 <childSessionId>）转告：…`）及指名 A 子会话 id 的回复提示——绝不含 CLI 会话 resume 句柄。

**provider 注入**——按各 CLI 的配置面一家一套机制，共享 kimi 建立的 register → bind(pid) → settle 时 unregister 模式与同一降级规则（core 早于成员通道时经 `typeof registry.registerMemberRun` 探针发现，run 与此前完全一致地继续，declare-and-degrade）：

- **kimi**（`packages/local-agent-kimi/src/member-bridge-config.ts`）：kimi 唯一的 MCP 配置面是 scoped home 共享的 `$KIMI_CODE_HOME/mcp.json`（已对官方文档核实：无逐次调用的配置 flag，且只有条目自身的 `env` 有文档保证到达 server 子进程——CLI 的进程 env 不是可靠通道）。同一文件被并发 run 共享，排除单一可变条目，因此 provider 写入**每 run 一条 server 条目** `dsh-member-<token8>`，socket 路径与 token 置于其 `env`——构造上无竞态——settle 时剪除，并在每次写入时清理其他家族条目（宿主崩溃残留）。kimi 文档化的 mid-session 语义保证两者安全：配置编辑不中断已打开的会话。
- **claude-code**（已对真实 CLI 端到端探针验证：模型调用了工具，桥完成往返，零权限提示）：逐次调用 flag，完全不写配置文件——`--mcp-config <json>`（单个 JSON 字符串声明 `dsh-member-<token8>` 的 command/args/env）加 `--allowedTools mcp__<server>__member_message`（claude `-p` 自动拒绝权限提示），fresh 与 resume argv 同样追加，skip 与普通权限模式一致。
- **codex**：逐进程内联 TOML 覆盖 `-c 'mcp_servers.dsh-member-<token8>={command=…,args=[…],env={…},default_tools_approval_mode="approve"}'`，`codex exec` 与 `codex exec resume` 同样携带；不触碰共享的 config.toml，因此无需清理。探针状态（2026-08-20 配额重置后复跑）：**端到端通过**——模型真实调用了 `member_message`，桥接往返成功。一个单测看不见的真实 CLI 发现：codex 稳定开启的 `tool_call_mcp_elicitation` 闸门在非交互 exec 模式下会自动取消没有 `readOnlyHint` 的 MCP 工具（"user cancelled MCP tool call"），因此覆盖里**必须**带每 server 的 `default_tools_approval_mode="approve"`。
- **dsh**：sub-dsh 是一个 dsh profile，成员桥走 harness 自带的 `@deepseek-ai/dsh-mcp-client`——家族 headless bundle 的 `cordis.patch.yml` 里一条 stdio 行，经 `!!js` env 读取每 run 坐标（`DSH_MEMBER_SOCKET` / `DSH_MEMBER_TOKEN` / `DSH_MEMBER_BRIDGE_ENTRY`，由 sub-dsh spawn env 的显式层传入）。该包从 dsh 安装的依赖闭包解析（boot 时链接进 scoped home 的 `profiles/node_modules` 兜底；已发布的 app 自 rc.6——家族的 minHost——起就携带它）。`failOnStartupError: false` 保证无成员通道的 core 上失败开放。

## Alternatives considered

- **引入 `@modelcontextprotocol/sdk`**——否定：依赖树中不存在，为一个工具的换行分隔 JSON-RPC 增加依赖换不来任何东西，约 200 行的独立 server 足够。
- **token 经 CLI 进程 env 下发**（桥作为其子进程继承）——否定：官方 MCP SDK 的 stdio transport 把继承环境过滤为安全变量白名单，只有配置条目自身的 `env` 是有文档的通道。（提案的「经 env 下发 token」仍被兑现——经 MCP 配置条目的 env。）
- **单一稳定 `dsh-member` 条目逐 run 重写**——否定：同一 scoped home 的并发委派在共享文件上竞争，而 kimi 没有逐次调用的配置 flag 可绕行。每 run 键的代价是工具名带每 run 后缀（每轮 `kimi -p` 本就是新会话，工具重新发现），且 pid 交叉校验使兄弟 run 可见的条目无法用于冒名。
- **为闸门契约 import room 的类型**——否定：鸭子类型的本地接口加 `ctx.get` 探针保持这条边零依赖（room 自己的建议），`check-plugin-independence` 无需新 sanction，room 缺席不可见。
- **家族侧解析成员名**——否定：名字属于 room 花名册；room 缺席时家族只接受子会话 id，它无歧义且始终可得。

## Consequences

- kimi 成员今日即可在 run 中互通知；回执词表（`sent` / `pending-confirm` / `busy` / `error: …`）对发送方结论稳定，无论由哪一侧（room 闸门或家族直发）产生。
- 闸门所有权单一：room 认领时家族绝不投递，room 的待确认卡流程不可能被绕过。
- 宿主崩溃会留下残留的 `dsh-member-*` kimi 配置条目；下一次 run 的写入会清理。token 比宿主进程长寿的 run 失败关闭（未知 token）。
- codex 的模型调用腿已**端到端通过**（2026-08-20 配额重置后复跑：模型真实调用了 `member_message`，桥接往返成功）。该次运行钉住了一个 exec 模式的必要条件：codex 的 MCP elicitation 闸门会自动取消没有 readOnlyHint 的工具，因此覆盖里必须携带 `default_tools_approval_mode="approve"`。claude-code 与 kimi 已过端到端探针；dsh 复用 harness 自己的 mcp-client，其工具调用路径有上游测试。
- 每 provider 的 argv/env 面是各 provider 的内部事务（kimi 的 mcp.json 条目、claude 的 `--mcp-config` JSON、codex 的 `-c` TOML、dsh 的 bundle 行）——四套机制，一份 registry 契约。
- 桥讲 NDJSON stdio（MCP TypeScript SDK 的帧格式）；用 header 帧的 client 不互通——接受：桥面向的是有文档的 kimi client 行为。

## Testing

`packages/local-agent/tests/member-channel.spec.ts`（11 例）：token 鉴权（未知/失效拒绝，异源或未绑定 pid 拒绝）、带出处的直发全链路（facade resume 以 B 记录的 parent/provider 被调，prompt 指名 A 且绝不含 B 的 CLI 会话句柄）、跨父拒绝、busy 回执、闸门三分支（room 认领 → 回执原样透传且家族不投递；room 拒绝 → 直发；room 缺席 → 直发）、成员名仅经认领的 room 解析、父不在线落地为 `error:` 回执、闸门抛错回落直发。`packages/local-agent/tests/member-bridge.spec.ts`（5 例）：内存 stdio 上的 initialize/tools-list 握手、对假 socket listener 的 tools/call 往返（断言 `{token, pid, to, text}` 载荷）、宿主拒绝映射为工具错误、未配置/不可达通道的工具错误、未知工具/方法的 JSON-RPC 错误码。`packages/local-agent-kimi/tests/member-bridge-injection.spec.ts`（6 例）：配置写入保留用户 server 并清理残留家族条目、settle 时移除、每 run 键形态、fresh 与 resume 轮注入（条目含 socket+token env、pid 绑定、settle 清理）、对无成员通道 core 的降级照常。claude-code（3 例）、codex（3 例）、dsh（3 例 + 1 例 patch 形态）的 `member-bridge-injection.spec.ts` 分别断言每 run 的 argv/env 注入（fresh + resume）、pid 绑定、settle 清理与降级路径；dsh 套件还钉住 headless bundle 的 mcp-client 行形态。测试套件：local-agent 134/134，local-agent-kimi 62/62，local-agent-claude-code 28/28，local-agent-codex 35/35，local-agent-dsh 37/37，local-agent-dsh-headless 19/19，local-agent-tool-subagent 10/10。

## Cross-references

- [成员通道提案](../../../proposals/active/2026-08-19-local-agent-member-channel.md)——里程碑计划（本 note 实现 kimi 的 M3）。
- [成员通道 M1+M2](2026-08-19-local-agent-member-channel.md)——本 note 依赖的 gateway remote 与可写 composer。
- [委派 facade](2026-08-18-local-agent-delegation-facade.md)——投递链复用的 resume/锁原语。
