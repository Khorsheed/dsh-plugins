# @khorsheed/dsh-local-agent-codex

[English](README.en.md) | 中文

把编码任务交给你电脑上的 Codex：过程实时看得见，跑完结果回到当前会话，还能接着聊。

有些活你就是想让 Codex 来干，以前得自己开终端跑、再把结果搬回来。装上之后，你在会话里说一句「这个交给 Codex」，agent 就把任务交给本机的 Codex；它的推理、工具调用和改了哪些文件实时出现在子会话里，跑完把结果带回来，附上真实的用量和耗时。Codex 在自己单独的目录里运行，你电脑上原来的 `~/.codex` 配置、登录和会话一点不碰。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/local-agent-codex.png" width="560" alt="展开的 Codex 一节：已登录的 Codex 和版本号，端点地址、API Key、「验证端点并获取模型」和可用模型名单">

## 能做什么

- **一句话交出去**：告诉 agent 哪段活给 Codex，它会自己写好要求交过去，结果回到当前会话。
- **过程看得见**：推理、执行的命令和改动的文件实时出现在子会话里，可以随时停下。
- **接着聊，重启也续得上**：让 agent 追问，或者打开子会话直接发消息，继续的是同一个 Codex 线程；DSH 重启之后也接得上。
- **填好 key 就能用**：在设置卡片里填端点地址和 API Key（官方平台的 key 或中转的 key 都行），点「保存凭据」，再点「验证端点并获取模型」确认能连上。
- **自己挑模型**：在「可用模型」里勾选、拖动排序，排第一的就是默认模型；子会话里也能临时换模型和推理强度。
- **常驻模式更快**：「常驻模式（live）」默认开着，Codex 进程常驻，输出实时流进子会话；停下不杀进程，崩溃后自动续上原来的线程。

## 安装

先在电脑上装好 Codex CLI（命令行里能运行 `codex`），插件不替你装。然后在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-bundle-local-agent
```

Codex 会跟着「多Agent协作」套件一起装好（各家本机 agent 共用同一个底座，单装用不起来）；如果你主要写代码，直接装开发套件 `@khorsheed/dsh-dev-suite` 也包含它。装完重启 DSH，到「插件」页的「本机 Agent 委派」卡片里，展开 Codex 一节填好端点和 API Key。

把活交给 Codex 要在带委派的模式里进行，比如「开发模式」：开一个新会话、选这个模式，对 agent 说「把这个交给 Codex」。在其它模式里看不到 Codex 委派是正常的。

## 已知限制

- 只支持端点和 API Key，不支持用 ChatGPT 订阅登录。
- Codex 没人在旁边批准：本来要你点头的操作会被直接拒掉，不会弹出来问你。
- `/codex` 这组命令只能在网页会话里用。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 配置项（沙箱、默认模型、常驻模式）、端点凭据的存放、自定义端点、回读与内部结构，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent-codex/docs/reference.md)里。
- 单独安装要连同底座一起点名：`dsh plugin --profile web add @khorsheed/dsh-local-agent @khorsheed/dsh-local-agent-codex`；委派工具由模式授予，没有模式点名时不会出现。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
