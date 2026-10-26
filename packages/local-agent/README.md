# @khorsheed/dsh-local-agent

[English](README.en.md) | 中文

让 DSH 把活交给你电脑上的 Kimi Code、Codex、Claude Code 或另一个 DSH，并在一张卡片里管好它们。

这是本机 agent 委派的底座，Kimi、Codex、Claude Code、DSH 四家都靠它运行。以前要同时用几个编码 agent，得在几个终端之间来回切，各自登录、各自记会话。装上之后，你在「插件」页的一张「本机 Agent 委派」卡片里给每家配好凭据和模型；在会话里把活交出去，交出去的子会话不是只读回放，你可以打开它直接接着聊；DSH 重启了，没做完的委派也接得上。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-card.png" width="560" alt="「本机 Agent 委派」卡片：Kimi、Codex、Claude Code、DSH 四节，每节标题旁的绿点表示已经配好">

## 能做什么

- **一张卡片管所有本机 agent**：每家一节，展开就能填凭据、排「可用模型」、开关「常驻模式（live）」；没装 CLI 的一家会标出「未检测到 CLI」。
- **子会话可以接着聊**：打开交出去的子会话，在底部输入框里给成员发消息，继续的是同一个会话；生成中的内容实时出现。
- **随时换模型和推理强度**：子会话的输入栏里就能切；正在跑的时候选好，下一轮生效。
- **重启也接得上**：委派记录留在本机，DSH 重启之后，没做完的子会话照样能续上。
- **说停就停**：`/local-agent stop <子会话编号>` 停掉一个正在跑的委派，`/local-agent list` 列出装了哪几家。
- **你电脑上原来的 CLI 一点不碰**：每家都在插件自己的目录里运行，原有的配置、登录和会话保持原样。
- **协作间里的本机成员也能求助**：在协作间里，Kimi、Codex、Claude Code 成员也能去问别的会话，回信回到它自己手上。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-member.png" width="560" alt="交给本机 CLI 的子会话：输出实时出现，底部的成员输入栏可以继续对话、切换模型">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-bundle-local-agent
```

本插件会跟着「多Agent协作」套件一起装好，连同四家本机 agent 和协作间；开发套件 `@khorsheed/dsh-dev-suite` 也包含它。各家的 CLI（`kimi`、`codex`、`claude`）要你自己先装好。装完重启 DSH，到「插件」页的「本机 Agent 委派」卡片里配好要用的那几家，然后开一个「开发模式」会话，对 agent 说「把这个交给 Codex」。

## 已知限制

- 各家 CLI 本体不代装；没装的那一家在卡片上显示「未检测到 CLI」。
- 委派记录只增不减，用久了要你自己清理插件目录。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 各家怎么注册进来、委派调用的选项、模型的取值顺序、命名 scope（一家多份登录）、容器内委派、成员通道与实时输出等，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent/docs/reference.md)里。
- 单独安装时，底座要和至少一家一起点名：`dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-kimi`（只装某一家不会自动带上底座）。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
