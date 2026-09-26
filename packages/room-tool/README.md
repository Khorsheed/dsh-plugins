# @khorsheed/dsh-room-tool

[English](README.en.md) | 中文

把房间的多 agent 能力交到模型手里：读名册、派消息、拉成员、写共享任务板——按会话授予，别的会话一概没有。

`@khorsheed/dsh-room`（core）把普通会话变成多 agent 房间：成员名册、共享任务板、目标计划都在 core 的服务与 UI 里。但模型侧的工具入口不该全局铺开——这个伴生包把 `room_read` / `room_plan` / `room_invite` / `room_task` / `room_message` 五个模型工具收进一条可按 preset 组合的工具行：preset 引用它，该 preset 的会话就有房间工具；其他 preset 的会话永远看不到。单实例多模式（提案 2026-08-26）工具行解耦的第二对（M4'②）：社区插件的模型工具行只进 preset、不进 profile 根。

## 特性

- **五个模型工具，按会话授予**——`room_read` 读名册/协调者/投递/近期成果/可用 provider（只读，不唤醒任何成员）；`room_plan` 经营正式目标（阶段、任务依赖、证据验收、暂停/恢复）；`room_invite` 邀请 CLI 成员（任意会话可调用，自动把会话升级为房间）；`room_task` 写共享任务板（add/close/update，与胶囊 UI 走同一组宿主函数，agent 开的任务与人类开的无法区分）；`room_message` 向成员派发消息（异步执行，回复以成员发言回到房间）。
- **零业务复制**——工具定义工厂全部由 core 导出（`@khorsheed/dsh-room/tool`），本行只做注册；注册前为每个工具打上以本包为 owner 的 origin tag，能力目录把工具归因到挂它的行，而不是服务核心。
- **core 缺席即 pending，不炸**——core 服务声明为 `inject = ['room']`（同族 companion 例外）：core 未挂载时该行保持 pending（注册表审计显示 `waiting for room`），preset 挂载照常成功、不报错；core 出现后行激活，五个工具注册生效。工具注册走 `ctx.inject(['tools'])` 延迟注入，挂载顺序永远不会把这行卡住。
- **无配置、无服务、无浏览器半部分**——`ctx.provide` 为零（preset 挂载面的 isolate-realm 规则只拒服务行，工具行可裸放 preset，与官方 `tool-bash` 行同构）；房间 UI 全在 core；可邀请的 provider 名单在调用时从全局 room 服务的花名册读取。
- **能力自适应**——`room_read` 只在挂载的 core 实现了 `readRoomContext` 时注册，`room_plan` 只在实现了 `commandPlan` 时注册；旧 core 上这两个工具整体缺席而不是报错。

## 安装

```sh
# core 仍按原样全局安装（room 服务 / 成员 UI / Remote 都在 core）
dsh plugin --profile web add @khorsheed/dsh-room
# 伴生工具行装进同一个 profile（可解析即可，不会自挂载）
dsh plugin --profile web add @khorsheed/dsh-room-tool
```

重启 web 实例后，在目标 preset 的 `agent.cordis.yml` 里按名引用本行，该 preset 的会话即获得工具：

```yaml
- id: room-tool
  name: '@khorsheed/dsh-room-tool'
```

web-dev 场景包的开发模式 preset（`profiles/web-dev/presets/dev`）已带此行，`install.sh`/`update.sh` 会把 preset 卸进 `$DSH_HOME/.agent-presets/dev`。

卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-room-tool
```

卸载后引用本行的 preset 会话不再获得房间工具；房间服务与 UI 由 core 提供，不受影响。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——0.1.5 官方插件列表的「会话插件」组按 preset 组合呈现本行（短名标题、状态徽标、活挂载相位点；3299 实测 33 行组合含本行且 `fiberPhase: active`）。成员邀请的实际可用性取决于 local-agent 家族的委派 facade 是否安装（同 core 的兼容性说明）。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）。
- 低于 0.1.5 的宿主：preset 组合机制在更早的线上已存在，但「会话插件」清单视图是 0.1.5 的呈现，minHost 钉 0.1.5-rc.1。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。

## 已知限制

- **计划与上下文读取依赖 core 的后端能力**——`room_plan` / `room_read` 只在挂载的 core 实现了 `commandPlan` / `readRoomContext` 时注册；旧版 core 上这两个工具整体缺席。
- **任务板写入要求当前协调者角色**——协调者交接给外部成员后，卸任的原生协调者仍可读取房间上下文，但 `room_task` 的写入只接受当前协调者。
- **执行完成 ≠ 验收**——`room_plan` 的一次执行结束只是提交成果，验收必须过证据复核；执行成员只能提交自己的活跃尝试，验收与组织归协调者或人类；修改预算与不确定执行的对账须由人类完成。
- **邀请 CLI 成员需要 local-agent 家族**——委派 facade 未挂载时 `room_invite` 返回可读错误文本（`local-agent-unavailable`）而不是抛错，模型可据此自我纠正。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**形态：不自挂载的伴生行。** 本包故意不声明 `dsh.bundle`：作为依赖安装只让模块可解析（plain dependency，同 `@khorsheed/dsh-local-agent-dsh-headless` 先例），不往任何组合挂行；授予入口是 preset 的 `agent.cordis.yml` 按名引用。这正是官方工具行的形状——发布的 `tool-bash` 行同样只消费宿主服务、不发布服务。

**注册路径。** core 的全局服务声明为 `export const inject = ['room']`（同族 companion 例外，见 `scripts/check-plugin-independence.ts` 的 COMMUNITY_SERVICE_INJECTORS）——preset 的 standing scope 在注册表激活时挂载，早于 profile 靠后 bundle 行提供 core，apply 时一次性 `ctx.get` 探测看到 ABSENT 后没有任何东西会重跑该行（rc.1 挂载序；2026-09-27 3080 生产实证）。声明式 inject 让该行 pending 到 core 提供再 apply：pending 期间注册表审计显示 `waiting for room`，preset 挂载不受影响；行内 `ctx.get('room')` 守卫保留为防御性直调路径（测试不经 loader 的 inject 机制直调 apply）。工具注册走 `ctx.inject(['tools'])` 延迟注入而非 apply 时探测：`ctx.get('tools')` 会与 tools 注册表自身的挂载顺序竞态并输掉（历史上静默永不注册的事故），`ctx.inject` 在注册表出现时触发，在没有注册表的组合里永不触发。每个注册都包一层带诊断标签的 `ctx.effect`（`room-tool: room_invite tool` 等）。

**origin tag。** core 导出工具定义时不带 tag（`@khorsheed/dsh-room/tool` 的契约——归因属于挂载方），本包在注册前为每个定义打上 `Symbol.for('dsh.tool.origin')` 键的 `{ channel: 'plugin', owner: '@khorsheed/dsh-room-tool' }`；tag 只留在宿主侧，从不上模型线路。

**工具语义。** `room_invite` 与 `room_message` 会 PROMOTE：在普通会话里调用就把会话升级为房间，而不是拒绝；`room_task` 在执行期把关——不在房间里时返回可读错误文本而不抛错，模型看得见拒绝并能自我纠正。校验失败（成员名、任务 id）的回复自带当前名册或打开任务列表，重试不必先补一次读取。外部 harness 经家族认证桥复用同一套 `room_read` / `room_invite` / `room_message` / `room_plan` 词汇（core 的成员桥能力）。

**导出。** 包导出插件本体（`apply`、`inject = ['room']`、cordis 诊断名 `room-tool`），无 Remote、无客户端 bundle；`./locale/*.json` 提供插件清单里的短名标题与描述（「房间工具」/「按会话授予房间成员、任务和消息工具。」）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/room-tool`）。问题与贡献请移步该仓库。
