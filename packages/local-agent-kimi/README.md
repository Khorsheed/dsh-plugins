# @khorsheed/dsh-local-agent-kimi

[English](README.en.md) | 中文

把活交给你电脑上的 Kimi Code：过程实时看得见，跑完结果回到当前会话，还能接着聊。

想让 Kimi Code 帮一把，以前得自己开终端、复制粘贴、再把结果搬回来。装上之后，你在会话里说一句「这块交给 Kimi」，agent 就把任务连同要求交给本机的 Kimi Code；它的思考、工具调用和回复实时出现在子会话里，跑完把结果带回来，附上真实的用量和耗时。Kimi 在自己单独的目录里运行，你电脑上原来的 Kimi 配置和会话一点不碰。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-kimi-settings.png" width="640" alt="「本机 Agent 委派」卡片里的 Kimi 一节：认证状态、端点和 API Key、可用模型、常驻模式开关">

## 能做什么

- **一句话交出去**：告诉 agent 哪段活给 Kimi，它会自己写好要求交过去，结果回到当前会话。
- **过程看得见**：子会话里一步一步列出 Kimi 的思考、调用的工具和回复，刷新页面也还在，不用等到最后才知道它干了什么。
- **接着聊，不冷启动**：结果不满意就让 agent 追问，或者打开子会话直接给它发消息，继续的是同一个 Kimi 会话。
- **填好 key 就能用**：在设置卡片里填端点地址和 API Key，点「保存凭据」，再点「验证端点并获取模型」确认能连上。
- **自己挑模型**：在「可用模型」里从端点供应的模型中勾选、拖动排序，排第一的就是默认模型；子会话里也能临时换模型和推理强度。
- **常驻模式更快**：打开「常驻模式（live）」，Kimi 进程常驻，输出实时流进子会话，停下也不用重开进程。
- **翻看以前的委派**：`/kimi sessions` 列出交给 Kimi 的历史任务，`/kimi session <编号>` 把其中一次整理成可读的记录。

## 安装

先在电脑上装好 Kimi Code CLI（命令行里能运行 `kimi`），插件不替你装。然后在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-bundle-local-agent
```

Kimi 会跟着「多Agent协作」套件一起装好（各家本机 agent 共用同一个底座，单装用不起来）；如果你主要写代码，直接装开发套件 `@khorsheed/dsh-dev-suite` 也包含它。装完重启 DSH，到「插件」页的「本机 Agent 委派」卡片里，展开 Kimi 一节填好端点和 API Key。

把活交给 Kimi 要在带委派的模式里进行，比如「开发模式」：开一个新会话、选这个模式，对 agent 说「把这个交给 Kimi」。在其它模式里看不到 Kimi 委派是正常的。

## 已知限制

- 只支持端点和 API Key（Kimi 编程平台的 key 或中转的 key 都行），不支持 Kimi 会员的网页登录。
- Kimi 仍会在你的 `~/.kimi-code` 里写几份没有实际内容的进程记录；配置、凭据和会话都留在插件自己的目录里。
- `/kimi` 这组命令只能在网页会话里用。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 配置项、默认模型的取值顺序、作用域目录、端点凭据的存放、常驻驱动和容器内委派等细节，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent-kimi/docs/reference.md)里。
- 单独安装要连同底座一起点名：`dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-kimi`；委派工具由模式授予，没有模式点名时不会出现。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
