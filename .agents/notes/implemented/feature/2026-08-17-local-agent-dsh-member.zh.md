# local-agent 家族新增 dsh 成员（local-agent-dsh）：dsh 自身可作委派目标

## 背景

`@khorsheed/dsh-local-agent` 家族（kimi / codex / claude-code）缺本引擎自身的成员：把 dsh 自己作为本地 CLI 委派出去。dsh 成员与其他三个同形（scoped home、会话记录、委派 provider、resume），同时复用父实例已有的 `DEEPSEEK_API_KEY`——不需要新的登录流程。设置区（Settings → 本地 Agent 旁新增 DeepSeek 页）提供互斥开关：**关（默认）→ 只注册官方 in-process subagent，dsh 的 harness/provider/工具一律不挂载**；**开 → 额外注册 `subagent_dsh`（外部进程形态）与官方 in-process 工具并存**。互斥的是"dsh 注册与否"，不是"工具数量"——开时模型同时可见官方 subagent（in-process、continuable）与 subagent_dsh（独立 CLI 进程），两者语义不同，家族工具描述已明确"separate process, its own scoped home"以便模型区分。

## 采用方案

### 1. 子 dsh headless bundle：`@khorsheed/dsh-local-agent-dsh-headless`

- 官方 headless 的兄弟 bundle：patch 叠加 `dsh-base`（system-prompt/hmr/tools/code-runtime 行与官方一致），插入家族 startup + runner 两行。
- **会话 id 由调用方提供，绝不从 stdout 解析**（评审修正 ①）：首轮 `dsh --profile headless-local-agent-dsh --session-id <uuid> "<task>"`，runner 把该 uuid 传给 `agents.create({ sessionId })`；resume `--resume <uuid>` 走公开 `ctx.agents.resume({ resumeSessionId })`（官方 continuation 冷续路径同款）。stdout 保持格式纯净，无分隔符前缀，也不会把长得像 id 的任务回答误解析。
- startup 用 commander 解析 `--session-id`/`--resume`（互斥）与 task 位置参数；**commander 把 `--resume` 的 attributeName 定为 `resume`（非 camelCase），映射到 service 字段时必须显式转换**（`--session-id` 则自动变 `sessionId`，不对称——实测踩坑）。
- 其他逻辑镜像官方 runner：`loader.await` → `agents.create`/`resume` → `whenIdle` → `followup` → `whenIdle` → `sessions.flush` → summarize → 打印 → `io.exit(0|1)`。`installModelSelection` 注册两个 waterfall 监听并返回 disposer（rc.7 版），setup 只调用不返回——进程生命周期内不需要显式 dispose。
- 会话 id 与 `session-` 前缀同 parent 侧格式；子 dsh 会话落在自己的 scoped-home 存储。

### 2. 子 profile 供给（零 pnpm install）

子 dsh 的 `$DSH_HOME` 是 harness scoped home（`$DSH_HOME/local-agent/dsh`），其 profile 目录必须在 scoped home 下（`profiles/headless-local-agent-dsh`）。供给只做四件事：

- 写 `package.json`：bundles = `["@deepseek-ai/dsh-base", "@khorsheed/dsh-local-agent-dsh-headless"]`；
- 写空用户层 `cordis.patch.yml`（`[]`）；
- 一条符号链接：`node_modules/@khorsheed/dsh-local-agent-dsh-headless` → 家族 bundle 目录（经 `createRequire(import.meta.url).resolve(.../package.json)` 从安装解析，`headlessBundleDir` 配置可覆盖）；
- 其余一切（dsh-base 及其整个依赖图、cordis、healed `profiles/node_modules` 回退）由 boot 从 dsh 安装锚点自动解析——`healProfilesModuleFallback` 在 `loadProfile` 之前跑，dsh-base 是 CLI app 的直接依赖，必然被 heal。

幂等：manifest/patch 存在即不覆盖；符号链接指向错误目标才替换（真实目录抛错）。首轮委派前同步调用，无异步等待。

### 3. 父侧 `@khorsheed/dsh-local-agent-dsh`：toggle 控制器 + `dsh-cli` provider

- **控制器**（patch 只插一行 `local-agent-dsh`）：注册 settings namespace `local-agent-dsh`（`{enabled: boolean}`，默认 **false**）；`sync(enabled)` 在 ON 时注册 `dsh` harness + `DshCliProvider` + 动态 `ctx.plugin` 挂载家族工具（`subagent_dsh`，config provider `dsh-cli`）；OFF 全部 dispose。settings `watch` 实时翻转；**generation 计数**防止在途的工具挂载在翻转/卸载后把 dispose 推进已死的 disposer 列表。
- **harness**：`name: 'dsh'`、`homeEnvVar: 'DSH_HOME'`、`delegationProvider: 'dsh-cli'`、**无 login**（评审修正：`LocalAgentHarness.login` 改可选，`/dsh login` 回答"无 device-code 登录，经宿主凭据认证"）、`isAuthenticated` = `credentials.resolve(credentialRef(apiKeyRef))` 是否出值、records 读子 dsh 自己的会话存储。
- **provider**（`dsh-cli`）：fresh 轮 `runId = SessionId(randomUUID())`，建父侧 childSession（descriptor + turn 标记），**先记委派**（childSessionId == cliSessionId，恒等映射，无需 stdout 解析），spawn `[launch, '--profile', profileName, '--session-id', runId, task]`；resume 轮 `resolveDelegation` + `acquireResumeLock` + 复用子会话 + spawn `--resume <id>`。spawn spec 的 **env 显式含 `DSH_HOME: <scoped home>` 与 `DEEPSEEK_API_KEY: <resolved>`**（评审修正 ③：subprocess seam 的 scrub 会去掉 `DEEPSEEK_API_KEY`（命中 `SENSITIVE_ENV_PATTERN`）与全部 `DSH_*`，显式 env 层在 scrub 之后合并是唯一过关路径；不注入 DSH_HOME 子 dsh 会落默认 `~/.dsh` 把会话写进父实例存储）。
- **launch 复制**：默认 `[process.execPath, ...process.execArgv, process.argv[1] ?? 'dsh']`——子 dsh 与父实例跑同一个 node + tsx + bin.ts；`cliLaunch` 配置可整体覆盖。**部署踩坑**：schemastery 对 `z.object` 里缺席的 `z.array(...)` 字段解析为 `[]`（而非 `undefined`），空数组被当作"覆盖为无前缀"吞掉 launch，spawn 以裸 `--profile` 开头 ENOENT——`dshLaunchArgv` 必须把空数组视为无覆盖（`length > 0` 才生效），并加了回归测试。
- 结算沿家族 abort 分支模式（requestCancel 立即 settle、dispose 负责 kill）；exit-0 无输出 → error；无凭据 → spawn 前 fail loud。
- **dsh 不做 transcript 镜像**：完整对话在子 dsh 自己的存储里（records 适配器可列）；父侧 childSession 只有 descriptor + turn 标记 + 最终答案，避免双份记录。

### 4. 设置区开关 UI

`local-agent-dsh` 包自带 client（`dsh.client` 行，`clientBundle` 产物带 `window.__ModuleLoader__.load` 头）：`ctx.settingsScope.bind({namespace: 'local-agent-dsh'})` 绑定 scope，并把开关**放进「本地 Agent」页 dsh harness 行的动作区**——核心 settings section 提供 provider-neutral 的按 harness 过滤动作槽 `local-agent.settings.row-action`（`renderSlot(..., { only: harness.id })`，只渲染、不认具体 harness），dsh client 经 `slots.inject` 贡献一个互斥 switch 按钮（id='dsh'，role="switch"，写 `scope.set('enabled', …)`；namespace 不可用时禁用）。独立 tab 与行下方卡片均已删除。宿主 watcher 收到写后实时翻转注册——开关即组合。行按钮不复用「重新授权/退出登录」：那些是认证动作（device-code/登出），dsh 没有登录流程，复用会语义撒谎且把"凭据状态"与"注册状态"两个状态机混在一行。

## 核心变更（评审三处修正落地）

- `LocalAgentHarness.login` 变为可选；`handle()` 对无 login 的 harness 回答"无 device-code 登录流程"；`runLogin` 改为显式接收 login 调用。
- 事实修正：官方 base 自带 in-process subagent 工具（`tool-subagent` spawn/continuable、`tool-subagent-fork`、`tool-subagent-control`、`tool-subagent-list-agents`）——安全边界是 **base 不含 local-agent 家族**（进程递归 dsh→dsh→dsh 需要家族 bundle 才会出现），base 默认保持不动，子 profile 复用官方 base 组合。
- `DSH_HOME` 与 `DEEPSEEK_API_KEY` 一起显式注入 `spec.env`。

## 验证

- **子 dsh runner 实机 nonce**（写 provider 前手动验证，一次通过）：`dsh --profile headless-local-agent-dsh --session-id <uuid> "记住口令 1739"` 建会话并记住；`--resume <uuid> "刚才的口令是什么"` 在同一子 dsh 会话里答出 **1739**；子 dsh 会话落在 scratch scoped-home 的 `sessions/` 下，不碰父实例存储。
- 单测：headless bundle 19 例（startup 的 session-id/resume/互斥/help；runner 的 create 用调用方 id、resume 走 factory.resume、无 id 回退生成、flush 先于 exit、abort/error/缺 appExit）；local-agent-dsh 24 例（controller off 零注册 / on 注册 harness+provider+tool / watch 翻转、provider fresh 的 argv/env/恒等记录、resume 的 --resume/锁/turn 2、缺凭据 fail loud、缺 cwd、exit-0 无输出 error、abort 立即 settle、records 读 zstd 头、provision 幂等/符号链接修复/安装解析、client 开关读写/不可用禁用）。
- `pnpm typecheck` 全绿；家族 `pnpm test` 全绿；`verify-translation-pairing` 39 对同步。

## 风险与后续

- `agents.resume` 冷续在子 dsh 跨进程场景已由 nonce 验证；`setup` 的模型选择与 create 同款接线。
- 家族 headless profile 绝不加入 local-agent 家族 bundle（守住 base 边界）。
- 映射持久化（parent 重启后 resume）与 kimi/codex 同限制（delegations 在内存），归入 codex 持久化提案批次。
