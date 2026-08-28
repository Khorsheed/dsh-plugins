# 插件开关管理器(dsh-plugin-manager):组合内插件的运行时开关

- **分类**:plugin(基础层;计划进 dsh-web-basic 整合包)
- **状态**:closed（放弃：唯一消费方 mode-switcher 已转向 agent preset 路线，不再需要行-overlay 写入器；官方 0.1.2 的 Plugin list 与 Plugin configuration 两个 tab 已覆盖「查看组合与改配置」，剩余的 loader 级开关价值不足以单独立项）
- **最后更新**:2026-08-22
- **查重结果**:已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`——无同意图提案。关联:[package-management](2026-08-21-package-management.md)(整合包成员)、[docs/ops.md](../../docs/ops.md)(验收期组合测试需求)。
- **官方依赖**:无。全部机制基于现有能力:loader 对 profile 用户 patch 层的 HMR(`watchUserPatches`)。零 harness 改动。

> **2026-08-29 废除。** 判定依据两条：
>
> 1. **唯一消费方消失。** [mode-switcher](2026-08-26-mode-switcher.md) 原方案把「模式」建模为插件行的活跃性，依赖本提案的共享行-overlay 写入器；重写后它改走官方 `agent-presets`（会话级组合），不再需要写 profile 用户 patch 层。本提案失去唯一的下游。
> 2. **查看需求已被官方覆盖。** 0.1.2-alpha.1 的 Plugins 设置区有两个 tab：`ui-settings-plugin-inventory` 提供只读清单（模块名、effective-enablement 标签、fiber 状态点、entry id 与生效配置），`ui-settings-plugins` 提供逐插件的配置编辑。二者都不能开关插件——`plugin-inventory` 的已知限制明写 *"it cannot enable, disable, add, or remove plugins"*——但「验收期想看清组合装了什么」这个更常见的需求已被满足。
>
> 因此**剩下的价值只有 loader 级开关**（写 `disabled: true` + config HMR 热生效，让插件根本不加载，区别于插件自实现的 `enabled` 配置）。该能力仍然真实存在但不足以单独立项；若将来验收流程确实需要，从本文件重开即可——方案与实测（`watchUserPatches` 已验证热生效）原样可用。

## 目标

在设置里提供一个"插件管理"分区:列出当前组合里所有 bundle 行,每行一个开关。**关闭 = 往 profile 用户 patch 层写 `disabled: true`,经 config HMR 热生效,不重启、不卸载**;打开即移除该禁用项。服务两类人:验收/调试期想自由组合开关的测试者,和"不想卸载只想临时关掉"的普通用户。

## 现状(已实测的事实)

- **patch 层 disable 是热生效的**。prod 上已两次实战:`- id: tool-result-pruner disabled: true` 和 `ui-brain-3d` 的关闭都是写文件即生效,无需重启(loader 监听用户 patch 层,改动即时重估)。
- **关闭 ≠ 卸载,语义分层**:
  - host 侧:行 disable 后 cordis 立即 dispose 对应 fiber,服务/命令/订阅即刻消失;
  - client 侧:客户端模块表在启动时扫描——被关插件的 UI 在**页面刷新后**消失;启用一个从未加载过的插件,同样需要一次刷新来取它的 client bundle;
  - 卸载(`dsh plugin remove`)是另一层:删依赖 + 删行,需要重启实例。开关插件不做这层。
- **外部插件天然可感知**:开关作用于 loader 行,与包来自哪里无关——官方 bundle、本仓插件、第三方插件的行同样在组合树里,同样可列可关。需要防呆的是官方关键行(webserver、session 存储、settings 本身)。
- **dispose 干净度因包而异**:本仓插件按约定 degrade-cleanly;第三方插件关后可能留残影,属于被关插件的责任,不阻塞本插件。

## 方案

**形态**:一个插件包 `@khorsheed/dsh-plugin-manager`,host 半 + client 半。

- **host 半**:枚举当前组合的行(来源:组合树/dump-config 语义,或解析 profile 的 bundle patch + 用户 patch 层);提供 Remote 面 `pluginManager.list()` / `pluginManager.setDisabled(id, disabled)`;写用户 patch 用原子写(tmp + rename),避免与手工编辑或其他 HMR 触发源的读写竞争。
- **client 半**:设置 → 插件管理分区。行列表(名称、来源包、是否官方行),开关,以及"刷新页面后界面完全生效"的提示。官方关键行(webserver、session 存储、settings、本插件自身)标"核心,不可关"或至少强警告。
- **归属判定启发式**:profile `bundles` 层列出的包所引入的行 = 可开关;`dsh-base`/`dsh-web-app` 官方行默认只读。

**明确不做**:安装/卸载(那是 `dsh plugin add/remove` 的地盘)、版本管理、重启编排。

## 里程碑

- M1:host 半——组合行枚举 + 原子 patch 写入 + Remote 面
- M2:settings UI(列表 + 开关 + 刷新提示 + 核心行保护)
- M3:验收——不重启关掉 whalesong(刷新后遮罩消失)、再开回;跨重启状态持久;关一个外部插件行;试图关核心行被拦

## 验收标准

- 不重启实例即可关/开一个插件:host 面立即生效(如该插件的命令/服务从组合中消失),client 面刷新后生效
- 开关状态跨重启持久(落在 patch 文件)
- 非本仓插件的行同样可关(外部插件感知成立)
- 核心行有防呆(拦截或明确警告)

## 风险 / 放弃的东西

- **被关插件 dispose 不干净** → 约定兜底 + 验收时逐包记录残影;本插件只保证行级 disable 正确送达。
- **patch 文件并发写** → 原子写 + 读后即写;真实冲突概率低(profile 写纪律已要求只经流程)。
- **用户关掉关键行把自己关死** → 核心行保护;最坏情况手工编辑 patch 文件可救。
- **放弃**:不做卸载/安装(避免与 `dsh plugin` 语义重叠)、不做"免刷新关 UI"的 hack(模块表是启动期事实,造假刷新语义比提示更糟)。
