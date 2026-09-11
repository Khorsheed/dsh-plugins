# Agent Note：worktrees 工具行拆分（按会话授予的模型工具）

Status: implemented

[English](2026-09-11-worktrees-tool-split.md) | 中文

## 问题

[单实例多模式提案](../../../proposals/active/2026-08-26-mode-switcher.md)要求社区模型工具行只进 preset、不进 profile 根——会话恰好在其 preset 授予时获得工具，模式差异无需重启。worktrees 此前是融合包：既 `ctx.provide` worktrees 服务、挂 Remote 数据面，又在 profile 根注册模型可见的 `worktrees` 工具，等于向所有 preset 的所有会话授予。融合包也根本进不了 preset：官方 preset 挂载面拒绝任何在 isolate realm 外 `ctx.provide` 服务的行（3092 实测）。徽标自隐试点（[gate note](2026-09-10-worktrees-badge-preset-gate.zh.md)）还留了一个维护异味：`visiblePresets` 手配名单与 preset 组合文件说的是同一件事，却是两份事实。

## 决策

**把工具行拆成伴生包**（`@khorsheed/dsh-worktrees-tool`），沿用 local-agent core/companion 先例并在 `check-plugin-independence` 里显式放行（`ALLOWED_EDGES` + `NO_OWN_PATCH`）：

- 伴生包不发布任何服务（唯一能进 preset 的形态），只注册一个模型工具，委派给主插件仍在 profile 根提供的全局 `ctx.worktrees` 服务核——官方工具行形态（出厂 `tool-bash` 行同样消费宿主服务）。
- 伴生包不声明 `dsh.bundle`：作为依赖安装只让模块可解析（`@khorsheed/dsh-local-agent-dsh-headless` 的 plain-dependency 先例）；授予入口是 preset 的 `agent.cordis.yml` 按名引用。`static inject = []`——worktrees 服务在 apply 时 `ctx.get` 探测，core 缺席则静默不注册（引用该行的 preset 照常挂载）；tools 注册表走 `ctx.inject` 延迟注入（沿用包内注册时代的挂载序竞态教训）。
- 工具定义工厂（`defineWorktreesTool(service)`）由 core 的 `./tool` 导出，业务实现零复制；origin tag 由伴生包自己打——归因跟随挂载包。
- core **停止在 profile 根注册该工具（BREAKING）**；UI/服务/Remote 不动。迁移：安装伴生包并在目标 preset 引用该行（web-dev 的 dev preset 已带）。

**徽标显隐默认判据改读官方组合数据**：client 探测 `ctx.get('remote.pluginInventory')`（绝不 inject——无 namespace 的宿主不能因此 pend 整个 client），每次挂载拉一次 `pluginInventory.list()`，当前会话的 preset 组里有 `@khorsheed/dsh-worktrees-tool` 行则显示。`visiblePresets` 保留为手动 override（非空名单按试点语义门控）。所有读不到的路径都 fail-open：无 namespace、RPC 失败、preset 组缺席或 `broken`、无 preset 的会话，一律保持显示。

**dev 模式 preset**（`profiles/web-dev/presets/dev`）是落地的消费方：官方 `standard` 组合（0.1.5-rc.1）+ 三家 local-agent 委派工具行（web-eval patch 的行形、去掉 `tools: none`）+ `worktrees-tool` 行；`profiles/web-dev/scripts/install.sh`/`update.sh` 把它卸进 `$DSH_HOME/.agent-presets/dev`（web-eval 形态——preset 是 pack 装置、整体替换；名册按 HOME 计、比 profile 长寿）。pack 的 patch 层仍是用户的，那里不钉 default。

## 放弃的方案

**core 包内第二 export 作为可挂载行**（`@khorsheed/dsh-worktrees/tool` 直接当行）。暂缓而非否决：Loader 是否支持把包的非默认 export 当插件行挂载尚未验证；伴生包是已验证的 local-agent 先例，checker 也会管。将来 loader 支持子路径行，伴生包可以无损并回 core。

**core 留一个向后兼容的全局注册开关**（`registerTool?: boolean`）。否决：这等于把旧的全局授予形态作为永久的第二路径背着走，每个组合都得猜当前生效的是哪套授予语义。breaking 已在 CHANGELOG/README 公布并附两行迁移；真正需要工具的地方加一行 preset 引用即恢复。

**组合数据读不到时 fail-closed 隐藏**。否决，理由与试点的 fail-open 相同：0.1.5 之前的宿主根本没有 `pluginInventory` namespace，升级即静默丢 UI 不可接受。fail-open 让旧线行为与从前逐字一致（永远显示）——那本来就是旧默认。

**行在但 `disabled` 时也算没有**。暂缓：判据读的是行的**存在**（提案的「组合里有我的行」）。休眠行是部署者刻意写进组合的；只读存在让判据只有一个字段宽。哪个 pack 真带休眠工具行且要求 UI 跟随授予而非名字时，再议。

## 后果

- **breaking，已公告**：升级后未引用伴生行的 preset 会话失去 `worktrees` 模型工具；徽标/右栏/服务/Remote 不变。两行迁移在 core README 与 CHANGELOG。
- **0.1.5 上无伴生行的部署默认显隐变了**：preset 没有 `worktrees-tool` 行的组合，徽标默认隐藏（组合判据）；`visiblePresets` override 可显式控制。0.1.5 之前的宿主不受影响（无 namespace → fail-open → 旧的永远显示默认）。
- **sanctioned 面扩大**：`check-plugin-independence` 新增 `worktrees-tool → @khorsheed/dsh-worktrees` 边与一条 `NO_OWN_PATCH`；checker 的 spec 持续约束全树。
- 0.1.5-rc.1 活体验证通过（3299，一次性 HOME）：dev preset 的「会话插件」组见该行（连委派行计数 28→32），活挂载读数 `fiberPhase: active`；dev/standard 会话间徽标干净翻转、console 零错误；组合 profile 根无 `worktrees-tool` 行；卸载伴生包后 dev preset 标 `broken`（「row … cannot be resolved」）而实例 boot 正常、其他 preset 照常挂载。证据：`scratch-screenshots/m4-*.png`。工具的真实模型调用留到 3080 终验（试点实例无 API key），已记录在验收汇报。

## 附记（同日）：room 对（M4'②）——模式零改动复用

`@khorsheed/dsh-room` 在 worktrees 对落地几小时后按同一形态完成拆分，**零形状变化**——这正说明该模式是模板而非一次性特例：room core 的三个工具工厂（`roomInviteTool` / `roomTaskTool` / `roomMessageTool`）把 origin tag 挪给注册方、经 core 的 `./tool` 导出；伴生包 `@khorsheed/dsh-room-tool` 以 `inject = []` 挂载、`ctx.get('room')` 探测、core 缺席静默不注册；`RoomService` 构造器里的 profile 根注册删除（BREAKING，同样两行迁移）；dev preset 加裸 `- id: room-tool` 行（无配置——可邀请 provider 名单由工具调用时从全局 room 服务读取）。checker 增加 `room-tool → @khorsheed/dsh-room` 边与一条 `NO_OWN_PATCH`。重建后的 3299 体验实例实测：dev preset「会话插件」组 33 行含 `room-tool` 且 `fiberPhase: active`，standard 组无此行；dev 会话头出现「邀请 agent」chip 与「成员」tab；console 零错误（证据：`scratch-screenshots/m4-room-dev-session.png`）。一条 room 特有的记录：既有 `tool.host.spec.ts` 本就在真实组合上测工厂行为，core 侧改为直接由工厂构建并钉住「不再注册」不变量，注册/origin 覆盖移到伴生包 spec——两对里最顺滑的一次测试迁移。

## 附记（同日）：room 会话 chrome 自隐（M3'②）

M3' 的另一半在 room 落地：「邀请 agent」头部 chip 与「成员」tab 只在当前会话的 preset 组合含 `@khorsheed/dsh-room-tool` 行时呈现——徽标判据包内内联（`src/client/preset-visibility.ts`；helper 包的取舍维持暂缓，两份内联仍比抽包便宜）。两条值得记录的决策：① **成员 tab 的隐藏发生在注册层**——`conversation.view` 的 tab 按钮由 ui-conversation 的 `viewTabs()` 从槽位注册表枚举，没有按会话谓词，组件 `return null` 只会留下一个空体按钮；`RegistrationToggle` 在判据通过时注册、不通过时注销（槽位自身的订阅会重渲染 tab strip——与 composer 晋升 bump 同一机制），而头部 chip 在会话树内按会话渲染，与 worktrees 徽标同走组件级。② **真 room 豁免**：已是 room 的会话无论 preset 授予什么都保留全部 chrome——纯组合判据会把拆分前创建的历史 room 搞残（E1）；豁免读 RoomStore 的缓存判定，所以非 room 的 standard 会话隐藏、任何 preset 上的 room 照常。3299 实测：dev 会话 chip + tab 齐全，standard 会话两者皆无（无空体 tab），来回切换干净翻转，console 零错误。
