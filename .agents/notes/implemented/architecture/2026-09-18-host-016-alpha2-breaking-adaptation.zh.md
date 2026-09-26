# Agent Note: host 0.1.6-alpha.2 breaking adaptation — session generations, inbox queue, slot-kind flips

Status: implemented

[English](2026-09-18-host-016-alpha2-breaking-adaptation.md) | 中文

## Problem

宿主跳过预期的 0.1.6 rc、改发 0.1.6-alpha.2(2026-09-17,距 alpha.1 共 887 commits / 2622 文件)。用户 2026-09-18 拍板:wave 直接重钉 alpha.2 并上 3080 作固定版本;共享 `~/code/deepseek-harness` 检出与 3080 在用户明确放行前均不动。alpha.2 重写了客户端会话服务(按代际 retain/借用)、把 composer 队列迁到 `inbox` 投影、翻转了两个槽位 kind、删除了旧 settings-plugin 槽家族。alpha.1 的六项适配在 alpha.2 复核全部仍成立(零返工);本 note 记录 alpha.2 这一批。probe+degrade 契约不变:每包在 0.1.5 上继续工作(minHost 不动),同时对 alpha.2 类型编译通过。

## What broke (eight hits, all fixed in this batch)

1. **`ISessions.open/openSubagent/clear` 删除** → `ctx.uiWorkspace.openSession(target)`,两条宿主线都有(0.1.5 `navigation.ts:134`、alpha.2 `navigation.ts:161`),但 alpha.2 失败时同步抛——所有调用点包 try/catch,降级为停留当前视图。打中:room、eval、ui-shortcuts、mobile(`MobileRooms`)、taskpilot(其 `prepare` 脚本卡死全仓 `pnpm install`,是第一个安装级阻断)。
2. **`SessionListState.current`/`currentAddress` 删除** → 从公开 list 推导:`Object.values(list.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)?.id`,鸭子回落 legacy `current` 字段(`(list as { current?: SessionId }).current`)。这就是官方的单一事实源——宿主自己在四处内联同一推导(侧栏树高亮、文档标题、session-maybe `publishMain`)。每个消费包各自内联 `mainSessionId` helper(约定禁止跨包依赖);鸭子类型变体避免新增 devDep。打中:room、mobile、ui-shortcuts、eval、mission、datasets、message-timeline、message-tools(`dom-hider`,清单外命中)、quote、local-agent(`ProviderAuthBlock`)。
3. **`SessionSnapshot.queue`/`QueuedMessage` 删除** → `useProjection('inbox')` 读 `InboxState['next-turn']`(`UserMessage`:`id`/`content`/`source`;rpcId 在 `source.kind === 'user'` 下),照抄官方 `QueueDock.tsx`(`previewOf`/`textOf`)。双线:投影缺失时(0.1.5)回落鸭子类型 legacy `snapshot.queue`。打中:room(`RoomComposer`)、mobile(`MobileQueue`、`SubmissionFocus`;新增 `src/client/queue.ts` 归一两种形状)。
4. **`conversation.chat.turnTail` chain → list**:注册强制 `id`、不跑 `select`;我们 `priority: -1` + `select` 的抢占机制性死亡。ui-file-preview 双形注册,在 `slots.inject` 回调内探测 `ctx.slots.spec(key).kind`(spec 两线都在):0.1.5 走 chain 形、alpha.2 走 list 形。**用户拍板共存**:`TurnFileRow` 与官方 `DeliverablesTail`、PlanCards 并存渲染,对比期后再定退役;2026-09-11「替换官方行」的旧产品决定作废。
5. **`settings.plugin.item` 槽家族删除**(ui-settings-plugins 重构)。context-guard 迁 `plugins.bundle.config`(按包名 key;官方槽契约写明 `plugins.item` 是宿主专用);ui-shortcuts 迁 `settings.plugins.tab`。两包都用**双臂注册**(两条 `slots.inject`,每个槽名一路)而非 `spec()` 探测:inject 的等声明机制对 apply 顺序无竞态,而 context-guard 先于 ui-plugin-manager apply 时 `spec('plugins.bundle.config')` 会返回 undefined 误判成 0.1.5。任一宿主线上恰好一路触发。
6. **`SessionPendingInteractionSnapshot` → `SessionStatusSnapshot`/`useSessionStatus`**(whalesong)。内部契约直接换新面;0.1.5 差异集中在边界一处适配器(`sessionStatusFromLegacyPending`,按源快照身份 memoize 以保住 controller 的 `next === prev` 短路)。
7. **`ModelDirectory.select()` 不再 reject**,返回 `RemoteResult<void>`(room 的 `RoomModelPicker`、message-tools 的编辑器 ModelChip)。settle 处理改读 `result && typeof result === 'object' && 'ok' in result ? result.ok : true`——settled 值带 `ok` 键按 RemoteResult 读,其余按旧成功,reject 分支留给 0.1.5。与官方消费方(`!result.ok`)同构。
8. **`[data-composer-stats]` DOM 锚删除**(mobile 紧凑统计行 CSS)。改为并集选择器补 `[data-composer-card] + div`(dock 行是卡片唯一直接后继,两线皆然——0.1.5 落在 `display: contents` 包装上惰性,alpha.2 命中真实 flex dock 行)。

行为注记:`sessions.scope()/binding()` 是对已 retain 代际的纯借用——即时解析立即用 + `?.` 两线安全;`sessions.using`/`retain` 在 0.1.5 不存在,rename 路径(session-title-edit、mobile `SessionRename`)保持 `binding(id)?.session` 双读,未升级。

## Decision

- **wave 重钉 alpha.2 作固定版本**(用户,2026-09-18):devDeps `^0.1.6-alpha.1` → `^0.1.6-alpha.2`(32 包),pnpm-workspace overrides + exclude 同步翻转(159 条),mobile 保留精确钉风格(`0.1.5-rc.1` → `0.1.6-alpha.2` 精确版,minHost 不动)。cordis 维持 4.0.2。
- **双兼容靠鸭子类型与双臂注册,绝不嗅探版本**:`mainSessionId` helper、inbox/legacy queue 归一、双形 turnTail、双臂 settings 槽、RemoteResult 感知的 select、边界适配器。零新增运行时依赖;context-guard 新增 `@deepseek-ai/dsh-client-ui-plugin-manager` 仅作 **devDep**(类型;运行时经 `slots.inject` 软集成)。
- **capability-catalog 无需改动**:其设置面是自己注册的 `settings.section` 条目(两线完好),从未走被删的 `settings.plugin.item` 派发;只有别处的陈旧注释残留那个心智。
- **新 upstream seam 候选**:命名的公开主选择 reader(ui-session 或 ui-workspace 导出 `useMainSession` selector)。数据本是公开的;宿主内联同一推导四处,我们现在约 10 个包又内联一遍——mainView 语义若变即静默漂移。将登记进 seam 台账。
- **inline-html-render 搭乘官方 browser**:`openLink` 探测 `sidebarRightTabs.get('browser')`,存在则 `openTab('browser', { params: { url } })`,回落 `window.open`(browser-pane 提案同日闭卷——用官方 Sidebar Browser,永不自研)。
- **ankh-guard emit `source` 保真继续挂起**:`fix/ankh-guard-test-lifecycle` 未合并且触及 `tests/preflight-drift.spec.ts` 及全包大半文件;保真打磨会撞车。该分支合并后再做。

## Alternatives considered

- **等 rc 再适配**——用户拍板在先:alpha.2 即目标,rc 变为复验闸。
- **立即退役 `TurnFileRow`**(官方 changed-files 卡覆盖 git 仓库回合)——用户拍板共存对比;我们的卡片仍独占:重启可重放(纯日志折叠)、覆盖非 git 目录、记录 read 操作。
- **`spec()` 探测 settings 槽**——apply 顺序竞态:先于 ui-plugin-manager apply 时探测会把 0.1.6 宿主误判成 0.1.5。双臂 `slots.inject` 无此窗口。
- **共享 `mainSessionId` helper 包**——无跨包依赖约定禁止;每包内联三行 helper 是既定形态。
- **rename 升级 `sessions.using`**——0.1.5 没有;binding 双读双线安全。
- **前移 `minHost`**——沿用 alpha.1 note 的理由;0.1.6 仍是 npm `alpha`,`latest` 是 0.1.5。

## Consequences

- 全部适配包对 alpha.2 构建测试双绿(room 224、ui-file-preview 96、whalesong 97、context-guard 47、mobile 95、taskpilot 48、ui-shortcuts 48、eval 609、mission 131、datasets 168、message-timeline 110、message-tools 193、quote 33、session-title-edit 45、local-agent 267、inline-html-render 26),每包都有钉住 0.1.5 路径的 legacy 回落用例。
- quote 在本分支切出后合入 main(`8f13f73a`);已在 worktree 内恢复并完成适配(含 `gen-typert.mts` 的 `TYPERT_PACKAGES` 条目),main 并入 wave 时正式化——add/add 冲突取适配副本(main 无更新的 quote 提交)。
- ui-shortcuts 设置卡在 alpha.2 上是独立 `settings.plugins.tab` 页(0.1.5 上是折叠卡)——列为 3080 视觉验收项。
- local-agent README 认领官方 subagent 侧栏聊天为零改动收益(MemberComposer 在嵌入 composer 选举中当选)。
- 上 3080 前余下:main 并入 wave(reader/canvas/sidechat/新版 eval-datasets 抵达并需各自 alpha.2 核查)、ankh-guard 套件对 alpha.2、`pnpm gate`、本地实例验证,以及任何 3080 或共享检出动作的用户明确放行。
