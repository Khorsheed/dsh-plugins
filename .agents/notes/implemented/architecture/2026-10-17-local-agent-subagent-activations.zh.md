# Agent Note: local-agent 家族映射到 0.2.1 subagent activations

Status: implemented

## 问题

宿主 0.2.1(`subagent-activations` 升级指南）删除了 `ctx.subagents.start()`。继任者 `SubagentRuntime.startActivation(spec)` 改变了 local-agent 家族依赖的三件事：

1. **送达语义**：每次 start 返回一个 activation;`delivery: 'parent'` 会通知父 Agent,`delivery: 'caller'` 只解析 `activation.result`。家族自收结果、经自家 Remote 推送，父通知会重复上报。
2. **取消劈叉**:`spec.signal` 只管到 publication 为止；manager 发布 activation 后摘除该信号，之后 `activation.dispose()` 是唯一的取消通道。家族的 `cancel()` 与调用方 signal 都建立在 0.2.0「signal 随时取消」的契约上。
3. **身份规则**:manager 拒绝与 live Session 同名的 provider run id(`DUPLICATE_CHILD`——`assertChildIdAvailable` 还会拒绝 resident id 与 live agent)。家族每个 provider 的 run id 恰好就是镜像出来的 child session id——天然 live——所以朴素映射能编译通过、却在运行时让每次委派失败。resume 轮次还复用同一个 child session id，冲突是结构性的，不是偶发。

同一波里还被删的：`ResolvedSubagentStartRequest.descriptor`(runtime 不再解析 one-shot descriptor;`snapshotSubagentDescriptor` 的 one-shot 重载没了）与 `SubagentCapabilities` 的 `persona`/`toolFilter` 字段。

## 决策

- **全部走 `delivery: 'caller'`**(facade `start`/`resume` 与家族工具）：家族 Remote 仍是唯一结果通道；父模型只看到工具结果，不会收到第二份完成通知。
- **child session id 改走家族 intent 通道**。fresh start 由 facade/tool 铸造（`LocalAgentDelegationIntent.fresh.childSessionId`,prepared-member 路径早已用 `preparedMemberId` 走同一通道）;provider 优先消费它。家族的追踪键、resume 句柄、`RESUME_HINT` 文案、客户端推送全部不变。
- **provider 发布 per-execution 的全新 run id**（全部 8 处 `subprocessRunHandle` 点，`SessionId(randomUUID())`)——与官方 dsh-sdk provider 的约定一致（「run id 活在父命名空间」)。manager 的 activation `childId` 变成家族从不读取的 opaque 执行身份。
- **facade/tool 返回适配器 `SubagentRun`**:`{ id: SessionId(childSessionId), result: activation.result, dispose: activation.dispose }`，家族公共面（facade 返回值、`trackRun`、`trackDelegationRun`、`settleForegroundRun`）形状逐字节不变。
- **取消改接 dispose**:`cancel()` 既 abort 控制器（publication 前）又 fire-and-forget dispose activation（之后）；调用方 signal(`DelegationCallOptions.signal`、工具的 `exec.signal`）重接到 `dispose()`，监听在 settle 时摘除。`subprocessRunHandle` 自身契约（dispose → requestCancel → result 以 `aborted` 结算 → teardown）使该链路与 0.2.0 的 signal 路径等价。
- **provider 自盖 descriptor**:`{ version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'one-shot', provider: this.name, label }`,label 由 `request.label` 组合——activation spec 的必填 label 在调用方未命名时以 `''` 到达，组合逻辑把 `''` 读作「缺席」(harness display name 胜出，与 0.2.0 默认值完全一致）。
- **`MemberControls` 增加按 child session 的兜底**:`runConfiguration` 的调用方现在持有适配器，拿不到 `admitted` WeakMap 所键的 provider run 对象。WeakMap 保留精确身份语义（member-controls.spec 钉着逐轮区分）;`admittedByChild` 服务适配器持有者——安全性来自同一 child 的轮次经 controls 队列串行，读取时刻的最新条目就是读者自己的那一轮。

## 否决的备选

- **绕过 manager（直接 `getProvider(name).start(...)`)**：否决——那会丢掉生命周期事件、activation 池化，以及宿主唯一受支持的消费路径；家族还得自背 manager 现在负责的 dispatch 预检，下一次 activation 语义变更会让我们碎得更狠。
- **provider 保持 `run.id == childSessionId`**：不可能——manager 的可用性检查拒绝任何在 live session 存储里可见的 run id，而 resume 轮次让 child session 永久 live。
- **`admittedByChild` 按轮次键（child + round)**：否决，过度设计——同一 child 的轮次从不交叠，而已知消费方都在下一轮 admission 之前读取自己那一轮的配置。

## 后果

- 家族的模型面行为不变：同样的 resume 句柄、同样的工具结果文本、同样的 Remote 推送、同样的 stop/cancel 结果。
- 家族 run 的宿主生命周期事件（`subagent/start`/`subagent/end`）现在携带 per-execution id 而非 child session id。家族没有消费者按它 join;provider 自己追加的 子代理 catalog/projection 行不受影响（catalog `version: 0, mode: 'one-shot'` 在 0.2.1 仍正常折叠）。
- `startActivation` 要求 `agents` 服务（manager)，且包一级还要求 runtime 新增的 `static inject = ['workingDirectory']`——挂载真 runtime 的测试组合必须两者都提供（并 enter 精确的父 Agent 对象；manager 比较对象身份）。
- 挂真 `SubagentRuntime` 的测试不能让 sessions 桩对 manager 的可用性探测（per-execution run id）回答「live」。
- 宿主 0.2.1 的 JSONL persistence 加载 native flock addon(`@deepseek-ai/node-addon-system-<platform>`)；新的 harness 检出要先在 `native/system/` 下跑 `pnpm build:native`，persistence 相关 spec 才能跑。
