# Agent Note: 跨 0.1.5 与 0.1.7 宿主的 settings 双线绑定(configForms 时代)

Status: implemented

## Problem

宿主 0.1.7-rc.1 删掉了社区包一直在绑定的 settings 两面:浏览器侧的
`ctx.settingsScope` 服务(含 `SettingsScope`/`SettingsScopeSnapshot`)换成了
`ctx.configForms`(`ConfigForm`/`ConfigFormSnapshot`);宿主侧的
`ctx.settings.register(ns, schema, opts)` 属主 scope API 换成了
`SettingsForms`——它服务插件行自身的 `Config` schema,且只编辑其中
`.volatile()` 标记的字段。各包必须在仍受支持的 0.1.5 线上继续工作,同时
接上 rc.1 新面——只用运行时探针,严禁版本嗅探,也不能因为一个只在单线
存在的服务把整个插件挂起。

## Decision

社区 settings 消费方按「一个结构面 + 延迟探针通道」绑两条线,分三部分:

1. **两种 scope 形状共用一个鸭子类型。** 0.1.5 的 `SettingsScopeSnapshot<T>`
   与 rc.1 的 `ConfigFormSnapshot<T>` 字段相同
   (`status/value/base/user/revision/writable`);写操作只差在决议
   (`Promise<void>` vs `Promise<boolean>`)。各包声明一个最小本地接口
   (context-guard 的 `GuardScope`、ui-shortcuts 的 `ShortcutScope`),不再
   import 任何一线的导出类型。
2. **迟到由代理消化,而不是 inject。** `configForms` 与 `settingsScope` 都
   不进插件的 `inject` 清单(任一都会在另一线上把包挂起)。两条延迟
   `ctx.inject([...])` 探针——先 rc.1 面、后 0.1.5 面——给包级通道上膛
   (context-guard 的 `GuardScopeChannel`;jobs 同构场景是 taskpilot 的
   `JobsChannel`),上任前通道发布 `unavailable`/空快照;slots 的 `hooks`
   席位从注册时起就指向通道。只需要写目标的注册表用 `bindHost`
   (ui-shortcuts 的 `ShortcutRegistryRuntime`),首次绑定生效。
3. **宿主半按线各供一节。** 包的 settings schema 以插件 `Config` 导出,
   运行期可编辑字段一律经**特性探针**打 `.volatile()`(0.1.5 的
   schemastery 3.18.2 没有此方法,探针在该线留下普通字段)。
   `ctx.inject(['settings'])` 内以 `typeof settings.register === 'function'`
   选择 0.1.5 的旧命名空间注册;否则是 rc.1——行自身的 Config 即被服务
   的表单,并以 `settings.configure({ auto: false }, ctx.fiber)` 把自动
   生成页摘出 settings 树(这里的每个包都自带卡片)。Config 注解一律
   裸 `z`:`z<T>` 在 exactOptionalPropertyTypes 下过不了 schemastery
   3.18.4 的方差(TS2375),不写注解又在 pnpm 布局下 TS2742/TS2883。

同次迁移沉淀的配套规则:

- **读自身 entry config 要解 Volatile。** rc.1 把 volatile 字段解析成活的
  `{ get() }` 引用,读 entry config 的代码一律解包(context-guard
  `resolveConfig` 的 `unwrapVolatile`、capability-catalog 的
  `readVolatile`)。
- **镜像内存态的块必须整块写。** `SettingsForms.update` 是递归合并,持久
  化块里被删的键会残留并经失效回环复活;镜像内存态的块
  (capability-catalog 的 `mcp`)走 `replace`(对活的字段整块置换),
  `update` 仅作兜底臂。
- **重载通道按线收窄。** rc.1 的 `settings/document-updated` 与 fiber 级
  `loader/volatile-update` 经鸭子收窄的监听器消费;0.1.5 继续用
  `scope.watch`。
- **夹具跟同一探针走。** 规格里删掉 `SettingsProvider` 基类与
  `stubSettingsScope`,换成旧 `register` 面的徒手 fake 与 rc.1 的
  `stubConfigForm`;rc.1 的 locale 插件注入 `configForms`,bench 一律补上。

## Alternatives considered

- **版本嗅探(读宿主版本,一次分支)。** 违反仓库既有铁律:一切适配走
  运行时能力探针,这样遇到意料之外的中间宿主会降级而不是选错边。
- **`settingsScope`/`settings.register` 留在 `inject` 里、优先 0.1.5。**
  只在单线存在的服务进 `inject` 会在另一线上把插件永远挂起;双臂延迟
  探针正是槽位注册已有的惯例(`plugins.bundle.config` vs
  `settings.plugin.item`)。
- **Config schema 注 `z.infer<typeof ...>` 或保留 `z<T>`。** 都输:
  `z<T>` 过不了 3.18.4 的方差;推断对象类型在 pnpm 的 `.pnpm` 布局下
  无法可移植命名;裸 `z` 是官方包与本仓其他行已在沿用的惯例。
- **mcp 持久化用 `update`。** 因正确性否决:合并语义会静默「反删除」
  server/凭据/工具开关(见 Decision)。

## Consequences

- context-guard、ui-shortcuts、capability-catalog 的 settings 面在两条
  宿主线上都工作,零宿主改动;把 ui-settings 摘除组合后按既有契约降级
  (按钮回落组合期数值,卡片不可见)。
- volatile 探针让 0.1.5 宿主完全感知不到标记、rc.1 宿主得到活表单编辑;
  schema 层面唯一的差异就是这个标记,因此存量 section 跨线兼容。
- `replace` vs `update` 在 rc.1 上是承重语义选择:删除一个 MCP server
  现在会真正从 profile 文档里删除(已对 `SettingsForms.write` 的
  mergeLayers/replace 实现核实;该臂没有构造级规格基座——此缺口在此
  记录在案)。
- 代价:每个持有 settings 的包都多一个小的通道/探针模块和一段双臂宿主
  代码;被删的官方类型(`SettingsScope`、`SettingsProvider`)不再能给
  夹具当锚点,fake 只能徒手重述旧面。
