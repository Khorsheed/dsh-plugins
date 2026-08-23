# 上游接缝请求登记处（官方不支持 → 绕行点台账）

- **分类**：T4（需官方运行时/契约扩展）集合
- **状态**：常驻登记处（随用随加，不归档）
- **目标**：集中收集所有"官方不支持该能力、且不接受 PR，我们不得不绕远"的点。每条记录：需求、当前绕行方案、官方落地后的退役条件。官方哪天开闸，这张表就是提交顺序的优先级清单；官方一直不开，这张表就是我们的长期维护成本台账。

## 条目格式

每条一节，字段固定：**需求 / 现状绕行 / 官方落地后的退役条件 / 状态**。状态取值：`绕行中`（线上跑的就是绕行方案）、`待实施`（方案已定未动工）、`已退役`（官方落地，绕行已拆）。

## 条目

### S1. 文件打开路由不可覆盖（产物行 / 正文 mention / 工具结果行）

- **需求**：第三方能替换"打开文件"的目标（官方写死 `workspaces.openPath` → 跳 OS/IDE）。
- **现状绕行**：turnTail chain 以 `priority: -1` 抢占官方产物行（first-match 选举）；正文 mention 用 document 捕获阶段 click 拦截（三道闸门 + fail-open）。代码标记 `TODO(official-opener-seam)`。**2026-08-21 E2E 实测补丁**：官方**工具结果行**的文件链接（write/run_code 等工具输出里的 disclosure 行 `button.fileLink`）同样是官方 openPath，不在上述两个拦截面内——点击静默跳 IDE（headless 无反应），插件无法接管；该入口留作官方打开覆盖点落地后的统一受益者，暂不另做拦截（避免与工具行披露折叠交互冲突）。
- **退役条件**：ui-conversation 提供文件打开覆盖点（可选 opener 服务或可替换的 `chatFileMentions`)。每次官方升级核对：chain 选举语义、`deliverables` 回合数据形状、mention 的 `code > button[title]` 结构、工具结果行的 `button.fileLink` 结构。
- **状态**：绕行中（@khorsheed/dsh-client-ui-file-preview）。

### S2. bash/子进程写入的文件不进任何日志结构

- **需求**：bash 工具（cat heredoc、sed -i、python 脚本）写入的文件出现在产物视图。实测：whalesong 游戏会话十几个 HTML 产物几乎全走 bash,fold 完全不可见。
- **现状绕行**："B 通道 + A 采集"——宿主侧采集器监听 `session/event`，从 `tool/call`（bash）命令里提取高精度写入候选（`cat > path` heredoc、单 `>` 重定向、`tee` 非追加、`sed -i`；`cp`/`mv`/`python open` 暂缓），`$VAR`/`~`/相对路径按宿主 env + 会话 cwd 展开，`tool/result` 落定后 `fs.stat` 验证（宁缺毋滥），存入按会话的内存登记表；`list` 把登记表并入 fold 结果；`session/created` 重放会话历史重建登记表（宿主重启不丢）。**不做**"追加 log-only 会话事件"：官方 `Session.append` 无法写入 `ignorable: true`，而持久化读回拒绝未知的非 ignorable 事件类型——插件事件进日志会毒化整个会话的读回（这本身是新的上游缝，见退役条件第三项）。
- **退役条件**：官方 bash 工具在结果 meta 带写入路径（小改，首选）；或执行层（沙箱/子进程）落文件写入事件（大改，根治）；或会话库提供插件事件类型的注册/`ignorable` 通道（日志追加方案才有落点）。官方落地后采集器整体退役，fold 改读官方数据。
- **状态**：绕行中（已实施，@khorsheed/dsh-file-preview 宿主半）。

### S3. Code Mode 嵌套派发无 diff 数据

- **需求**:`tool/code-dispatch` 事件带 oldText/newText（或 diff hunk)，让 code-kimi 会话的文件也有改动记录。
- **现状绕行**：无——列表能进（S2 之前修的 dispatch fold)，改动记录 tab 对这类文件隐藏。
- **退役条件**：官方在派发事件里带 diff 数据。
- **状态**：绕行中（无绕行，纯缺失，UI 如实隐藏）。

### S4. Code Mode 派发事件无 turn/step 归属

- **需求**:`tool/code-dispatch` 事件带 turn/step，回合级 fold（变更卡片）才能归属嵌套变更。
- **现状绕行**：宿主 fold 借外层 `run_code` 根调用的 turn/step（列表可用）；客户端回合卡片无法归属（match 拿不到 turn),code-kimi 会话不出卡片。
- **退役条件**：官方给派发事件补 turn/step 字段。
- **状态**：绕行中（部分）。客户端卡片侧的缺失等官方补字段。

### S5. Typert Remote 生成器只在官方构建链

- **需求**：社区仓库能独立生成 `lib/typert.*`(Remote 客户端/宿主产物）。
- **现状绕行**：构建放在官方 checkout 测试位跑（dsh-plugins 的 `build/vitest.ts` 与 gen-typert 已按此搭好）;file-preview 迁移提案里的决策点。
- **退役条件**：官方把生成器作为可独立运行的包发布。
- **状态**：绕行中。

### S6. 官方包 scope 不可发布 → 打包改名的正确姿势

- **需求**：社区包发布到自有 npm scope 时，家族内互相引用（peer、patch 行、lib 产物里的 import specifier）全部换名。
- **现状绕行**:`scripts/pack-dist.ts --family`（已实施，含改写后残留扫描）；注意该脚本在官方仓 scripts/ 下，dsh-plugins 已复制一份。
- **退役条件**：无需退役（这是发布工具，不是绕行官方缺陷）。登记在此因为它源于"官方不接受 PR"的约束。
- **状态**：已退役（工具已自建）。

### S7. 守卫凭证自报制（不含类型检查覆盖证明）

- **需求**:checkpoint/restart 的绿色凭证由守卫自执行命令验证，而不是 agent 自报。
- **现状绕行**：无（guard 是自家包）。建议已整理成交给守卫维护者的一段话（`--gate <cmd>` 方案，含后台触发盲区的开放问题）。
- **退役条件**：守卫包实现 `--gate`。
- **状态**：待实施（ankh-guard 维护者评估中）。

### S8. 官方 SDK JSON-RPC wire 无 turn 级 interrupt/cancel

- **需求**：长驻子实例（`dsh-jsonrpc-agent` / `@deepseek-ai/dsh-sdk-jsonrpc-server`）能被外部优雅中断当前 turn——local-agent live driver 的核心动机就是 runtime 级 cancel（进程不死、会话可续）。官方 wire 只有 `initialize` / `session/prompt` / `shutdown` + 通知流，无 interrupt；`@deepseek-ai/dsh-sdk-client` 注释明确"a timed-out request stays running server-side until the runtime is closed"。
- **现状绕行**：自家 headless bundle（`@khorsheed/dsh-local-agent-dsh-headless`）的 `--serve` 模式自建一条同形制的 NDJSON JSON-RPC wire（`src/wire.ts`，帧格式对照官方 `JsonRpcLineTransport`），interrupt 走进程内官方 `Agent.cancel({kind:'parent'})`——这是自家 composition 调用官方 in-process API，不是 hack。
- **退役条件**：官方 SDK wire 增加 turn 级 interrupt 方法（且保持调用方指定 session id 的懒创建语义）。届时 serve 模式整体退役，provider 的 live driver 改挂官方 server。
- **状态**：绕行中（@khorsheed/dsh-local-agent-dsh live driver + headless serve 模式）。

### S9. `dsh.bundle` 声明把"要被安装"和"要被挂载"绑死

- **需求**：家族内部 bundle（如 `@khorsheed/dsh-local-agent-dsh-headless`）需要声明 patch 供自己的子 profile 引用（app-boot 对 layer 列表里不声明 `dsh.bundle` 的包 fail loud)，但**不能**被 reconcilePlugins 自动挂进交互式组合——reconcile 把声明 `dsh.bundle` 的 profile 直接依赖全部挂进 layer 栈。2026-08-23 P0:headless bundle 作为 prod web profile 直接依赖被自动挂载，其 `code-runtime` insert 行与 web-app 同名行撞 duplicate entry id，全实例 boot 失败。
- **现状绕行**：纪律 + 哨兵——ops 文档明示"内部 bundle 只作传递依赖"，包内不变量检出 web 组合（`webStartup` 服务存在）即 fail loud,patch 测试钉住撞 id 的行。安装路径不变（传递依赖天然不被挂载）。
- **退役条件**：官方把声明拆开——例如 `dsh.bundle.autoMount: false`（或 `profileOnly`)，让 reconcilePlugins 跳过这类包；届时内部 bundle 可以放心作直接依赖（例如显式锁定版本），哨兵不变量可留作防御。
- **状态**：绕行中（@khorsheed/dsh-local-agent-dsh-headless)。

### S9. runtime skill 注册的 `source` 只在加载期校验

- **需求**：`ctx.skills.register()` 在注册期就要求（或默认）`source`——官方 `register()` 默认了 `provider`/`invocation` 但不默认 `source`，而加载路径 `validateDefinition` 强制 `source` 为 string：于是注册成功、catalog 正常列出、调用才炸（8.9 的 `dsh-self-restart-guard` 就是这个炸法）。
- **现状绕行**：调用方显式传 `source: 'runtime'`（ankh-guard hotfix f38a616）；并用真实 `SkillRegistry` 的 list + get 往返测试守住契约（记录桩测不出加载期校验）。
- **退役条件**：官方 `register()` 默认 `source: 'runtime'`，或 `validateRuntimeSkill` 在注册期就强制 `source`。落地后调用方的显式字段保留无害，往返测试可保留为行为回归。
- **状态**：绕行中（@khorsheed/dsh-ankh-guard 的 skill 注册）。


## 维护约定

- 新增条目：发现"官方不支持 → 绕行"即登记，先登记者在提案总表更新计数。
- 条目退役：官方落地后同一 PR 里拆绕行 + 标 `已退役` + 写明退役版本。
- 每次官方升级：逐条核对"退役条件"是否已满足（S1 的核对清单可以直接抄进升级 checklist)。
