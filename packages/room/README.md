# @khorsheed/dsh-room

[English](README.en.md) | 中文

把一个会话变成协作间：请几个 agent 进来，@ 名字派活，你在旁边看着、拿主意。

让几个 agent 合干一件事，以前只能在几个窗口之间来回复制粘贴，谁做到哪一步全靠你记。装上协作间，在会话里邀请第一位成员，这个会话就成了协作间：dsh 自己当协调者，帮你拆活、派活、收结果；Kimi、Codex、Claude Code 或另一个 dsh 都能当成员，各干各的、互相传话。你得到的是一个房间：谁在干什么、干到哪、花了多少，一眼看清，最后验不验收还是你说了算。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-1.png" width="560" alt="一个进行中的协作间：聊天流里的成员回复与运行行，输入框上方展开的 @ 成员菜单">

## 能做什么

- **邀请就开房**：点会话头部的「＋ 邀请 agent」，选好成员、模式、模型和思考强度；第一位进来，这个会话就成了协作间，不用另外建。新成员默认跟房间用同一个模式。
- **@ 谁就派给谁**：@ 一个或几个成员，它们同时开工；回答边写边出现在房间里，想停只停那一位。每个成员留着自己的会话，点进去就能看它干了什么。
- **找房间外的会话帮忙**：@ 菜单里也列着别的会话和别的协作间，选一个，协调者就去问它；成员自己也能去问，Kimi、Codex 这类成员也一样。第一次找你没 @ 过的会话，会先等你同意；对方的回信带回房间，等太久那一行会变黄提醒你。
- **成员问你，点一下就答**：成员需要你拿主意时，房间里会出现一张「某某 问你」的卡片，点选项或写一句话就行。
- **任务一眼看清**：输入框上方写着「N 个任务进行中」，点开能看到每个任务谁在做、做到哪、用了多少；需要你处理的会标黄，可以停掉整个任务，也可以只停其中一步。
- **团队一张图**：成员页的「团队」画出你、协调者和成员之间谁给谁派活、各自在忙什么；常找的外部会话可以「加入房间成员」，下次直接 @。
- **它替你拿的主意都留了底**：新消息算新任务还是并进旧任务、成员的结果什么时候交给协调者，房间会自己判断，每次判断都在时间线上留一行，点「查看判断」看依据；不想让它判断，就去「协作设置」的「自动判断」里关掉。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-invite.png" width="560" alt="成员页：空态的「把会话变成多 agent 协作间」与会话头部的「＋ 邀请 agent」入口">

- **你说了算**：任何成员都能「设为协调者」接班；「协作设置」里可以让成员之间的消息先等你确认，也可以「暂停房间」，成员的新消息先排队，恢复后照顺序送达。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/room-2.png" width="560" alt="成员页：成员卡片（名称、provider、角色、模型）与「设为协调者」操作">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-room
```

它也会跟着「开发套件」「剪辑套件」「游戏开发套件」和「多Agent协作」一起装好。装完开一个「开发模式」「剪辑模式」或「游戏开发模式」的会话，点会话头部的「＋ 邀请 agent」开始。在其它模式里看不到这个入口是正常的。

## 已知限制

- 要邀请 Kimi、Codex、Claude Code，还得装「多Agent协作」（`@khorsheed/dsh-bundle-local-agent`）；没装时只能邀请 dsh 自己的成员。
- 已归档的会话不会出现在 @ 菜单里，也找不了它帮忙，要先取消归档。
- 协作间的会话离不开这个插件：卸掉之后，以前的协作间会话读不出来。

## Compatibility

需要 DSH 0.1.5 或更新版本，已在 0.2.1 上验证。

## 给开发者

- 入口：`src/index.ts`（房间服务）、`src/tool.ts`（agent 用的协作工具）、`src/client/index.ts`（界面）。单独安装（`dsh plugin --profile web add @khorsheed/dsh-room`）时，协作工具要由某个模式授予，入口只在那些模式的会话里出现。
- 协调者与派活流程、事件日志、工具、兼容细节和内部结构，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/room/docs/reference.md)里。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
