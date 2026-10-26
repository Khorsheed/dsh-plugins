# @khorsheed/dsh-local-agent-dsh

[English](README.en.md) | 中文

把子任务交给你电脑上另一个单独运行的 DSH：它有自己的会话和设置，跑完结果回到当前会话，还能接着聊。

有些子任务你想让一个干净的 DSH 来做：不带当前会话的上下文，有自己的会话记录，也不会动到你正在用的这个实例。装上之后，在设置里打开「DeepSeek 委派」，agent 就能把这类子任务交给本机另起的一个 DSH；它的输出实时出现在子会话里，跑完把结果带回来，之后还能在同一个子会话里接着干。

## 能做什么

- **默认关着，想用再开**：开关关着时一切照旧；在「本机 Agent 委派」卡片的 DSH 一节打开「DeepSeek 委派」，agent 才能把子任务交给它，不用重启。
- **不用另外登录**：它沿用你在当前 DSH 里选的模型和 key，卡片上直接显示凭据能不能用。
- **互不打扰**：子 DSH 的会话、设置和状态都放在单独的目录里，不会出现在你的会话列表里，也不会改动当前实例。
- **过程看得见**：子 DSH 的输出边跑边出现在子会话里。
- **接着聊**：让 agent 追问，或者打开子会话直接发消息，继续的是同一个子 DSH 会话。
- **指定模型**：卡片的「默认模型」里选一个模型，之后每次委派都用它；留空就跟随当前 DSH 的默认模型。
- **常驻模式更快**：打开「常驻模式（live）」，子 DSH 常驻，停下不杀进程。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-bundle-local-agent
```

本插件会跟着「多Agent协作」套件一起装好（各家本机 agent 共用同一个底座，单装用不起来）；开发套件 `@khorsheed/dsh-dev-suite` 也包含它。装完重启 DSH，到「插件」页的「本机 Agent 委派」卡片里展开 DSH 一节，打开「DeepSeek 委派」，然后在会话里对 agent 说「把这个子任务交给本机的 DSH」。

## 已知限制

- 没有单独的登录：子 DSH 只能用当前 DSH 里配好的模型凭据。
- `/dsh` 这组命令只能在网页会话里用。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 配置项、子 profile 的准备方式、权限档、默认模型的取值、常驻驱动和容器内委派等细节，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent-dsh/docs/reference.md)里。
- 单独安装要连同底座一起点名：`dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-dsh`；子 DSH 由 `@khorsheed/dsh-local-agent-dsh-headless` 提供，会自动跟着装上。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
