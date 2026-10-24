# Agent Note: Room 邀请对话框提供模型的推理强度行

Status: implemented

## 问题

Room 的邀请对话框能钉住成员的模型,却钉不了推理强度——尽管下面每一层都早已会说 effort:local-agent core 的委派 `start`/`prepareMember` 选项接受 `effort`,三家 CLI provider 都在 spawn 时绑定它(kimi 走 scoped config,codex 走 `-c model_reasoning_effort=…`,claude-code 走 `CLAUDE_CODE_EFFORT_LEVEL`),家族客户端的 `ModelConfigurationFields` 也早已渲染模型+强度成对的控件——只是共享的 `HarnessModelPicker` 以 `showEffort={false}` 挂载它,并把每次选择的 effort 半边丢弃了。

## 决策

逐层镜像邀请时模型通道,不多不少:

- **`HarnessModelPicker`** 增加可选的 `effort: { value, onChange }` prop。传入 = 菜单显示强度行、每次选择同时上报两半,且选择后不再关菜单(面板内导航,与成员配置卡片一致);不传 = 逐字节保持原来的纯模型控件,provider 设置卡片不受影响。
- **Room 邀请对话框** 在模型草稿旁维护 `effort` 草稿(空 = 跟随 harness 默认),传给 picker,切换 provider 时一并重置,提交时为空则省略。legacy 纯输入框降级路径(无 broker 的 harness)保持只有模型——降级而不爆炸。
- **Room 宿主** 把 `effort` 铺到 `model` 走过的每一处:`RoomInviteRequest` / `room/member-added` / `RoomMember` / `room/member-updated`(null 即清除)/ `RoomUpdateMemberRequest`、journal 回放折叠、邀请校验(空白 effort = `empty-text`)、updateMember 守卫(已启动成员报 `configuration-owned-by-core`;effort 算作一次更新)、`restoreMember`、`prepareMember`,以及首次派发的 facade `start` 调用。面向 agent 的 `room_command` 邀请与 `model` 一样接受 `effort`。

编辑模式的归属不变:已启动成员的配置(模型与强度一样)归共享的成员配置卡片所有,它整体替换对话框自己的字段;对话框的 effort 草稿只为从未启动成员的日志意图存在,且编辑 diff 只在该成员仍无子会话时落日志。

## 备选方案

- **对话框里单做一个强度下拉框**:重复了模型目录已有的词表(每个模型的 `reasoning.options`),harness 一改级别就漂移;搭 `ModelConfigurationFields` 的车则只有一个事实源。
- **给 `LocalAgentModelInfo` 加 effort 选项喂 legacy 输入框**:legacy 分支恰恰是为没有家族客户端半边的组合准备的;给它加功能是拿契约成本换降级路径特性。picker 自己的目录读已经带选项,所以只有 picker 路径得到这一行。

## 影响

- 新邀请可以钉住强度;旧日志回放不变(键缺席,从不会是空白)。
- 已启动成员的强度仍只能经成员配置卡片改(core 所有、按轮次边界排队);room 日志绝不重复写。
- Context Lens 经既有的 `request/header` 通道读到 spawn 绑定的 effort(见 2026-10-23-external-agent-request-headers)——消费方零改动。
- 在途的 `room-members-extension` 分支原型过自己的 effort 字段;本次实现是它 rebase 的基(它的是对话框局部方案,这次把宿主 + 日志 + provider 全链路铺通了)。

## 测试

`pnpm --filter @khorsheed/dsh-local-agent test`(picker 用例:effort prop 展开强度行、两半都上报、菜单保持打开)与 `pnpm --filter @khorsheed/dsh-room test`(service.host:invite/updateMember 的 effort 落日志、trim、null/空白清除、空白拒绝;dispatch.host:facade start 只在邀请带 effort 时带上它;members.client:共享 picker 的 effort 选择进入邀请请求)。
