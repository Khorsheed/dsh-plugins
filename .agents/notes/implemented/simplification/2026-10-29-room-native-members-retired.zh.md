# Agent Note: 原生 dsh 子成员退出协作间，由 dsh 命令行成员接替

Status: implemented

## Problem

协作间有两种方式把 dsh 拉进来当成员。**原生子成员**（`kind: 'native'`，2026-10-23 随协作间改版加入）是宿主进程里的一个子会话加 agent，组合所选的 preset。**dsh 命令行成员**（`local-agent-dsh`，provider `dsh-cli`）是独立的 sub-dsh 进程，和 Codex、Claude Code、Kimi 走同一条成员桥接，接入房间和它的模式。

每个房间功能都要做两遍：一遍给桥接成员，一遍给宿主内的原生路径。2026-10-29 的房间桌面只给桥接成员做了，原生成员就留了缺口。而原生成员本身是两者里较弱的那个：

- 不能当协调者；
- 模式和模型在创建时锁死；
- 3080 上 45 天内的 22 个协作间里一次都没被邀请过。

同期 Kimi 被邀请 17 次、Codex 16 次、Claude Code 14 次、dsh 命令行成员 1 次。

这和房间自己的 dsh 是两回事：`main-agent` 成员就是房间会话本身，没设外部协调者时由它接待和协调，它保留。

## Decision

用户 2026-10-29 决定移除原生子成员。

- **邀请。** `RoomInviteRequest` 去掉 `kind`，邀请一律生成 CLI 成员。邀请框去掉「原生 dsh 子成员」选项、它的提示和只属于它的 preset 分支。留下的模式下拉框是 CLI 成员的：默认跟房间同一模式，可选「不带模式」。
- **回放。** 旧日志里 `kind: 'native'` 的 `room/member-added` 不进成员名单。它的发言行留在记录里，但不再给它派活、不再以它的身份路由、也不再取消它。`RoomMemberAddedEvent.kind` 保留 `'native'`，让这些旧日志仍能通过类型检查；`RoomMember.kind` 只剩 `'main-agent' | 'cli'`。
- **删除的部分。** 派发路径（`nativeAgent`、`runNativeMember`）；把子会话的房间工具调用路由回父房间的逻辑（`nativeRoute` 及它在邀请、消息、求助、读取、计划里的调用方）；不许原生成员当协调者的判断；原生成员的取消分支；只给原生成员用的文案键。
- **补上接替者的缺口。** dsh 命令行成员现在和其他 CLI 一样拿到模式的 skills：local-agent 的 `mode-skills.ts` 把它们写进 `$DSH_HOME/skills/dsh-<name>/SKILL.md`，也就是 sub-dsh 的 `user-dsh` skill 根目录。

## Alternatives considered

- **保留原生成员，每个新房间功能都给它移植一遍。** 每个功能多一条路径，养着一个没人邀请、不能协调、不能换模式的成员类型。
- **只隐藏邀请入口，代码留着。** 会剩下约一百处休眠分支，每次改房间都还得让它们编译通过、还得想清楚它们的行为，而 3080 上根本没有这样的旧日志。
- **把旧的原生成员迁移成 dsh 命令行成员。** 没有可迁移的对象；原生成员的历史在宿主内的会话里，sub-dsh 也无法续接。

## Consequences

协作间只剩一条成员路径（桥接），外加房间自己的 agent。成员的各项能力（模式工具、skills、桌面、审批、协调、换模型）现在都来自同一处。

代价：

- dsh 成员现在是独立进程，不再是宿主内的 agent。
- 和所有桥接成员一样，它拿得到模式的插件工具和 skills，拿不到模式的系统提示词片段。
- 社区里真邀请过原生成员的日志，旧发言仍会显示，但这些成员已不在名单上。

## Testing

- `room`：`native-member.host.spec.ts` 改为钉住移除后的行为。宿主 preset 仍作为模式列出，未声明的 preset 被拒绝；旧日志里的原生成员不在名单上，给它发消息失败，也不会为它创建 agent 或挂载模式。
- `room` 成员客户端测试：模式下拉框默认「不带模式」，没有原生选项，邀请请求只带 CLI provider 和模式。
- `local-agent`：`harnessSkillsDir('dsh', home)` 返回 `<home>/skills`。
