# @khorsheed/dsh-context-lens

[English](README.en.md) | 中文

点一下任意一轮对话，就能看到模型这一轮到底收到了什么、token 花在哪、时间耗在哪。

调提示词、写插件的时候，你最想知道的往往是：这次请求里到底塞了什么？缓存为什么没命中？这一轮怎么这么慢？以前只能翻日志、自己拼。装上上下文透镜，在对话里点一下某一轮旁边的图标，右栏就把这一轮的每一次模型请求摊开给你看：系统提示每一段从哪来、带了多少工具、哪些是历史、哪些是这次新加的，再配上耗时的拆分。你一眼就能看出注入是不是太多、缓存从哪个字开始断的、时间都花在了哪一步。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-1.png" width="640" alt="点回答下面的「请求明细」图标，右栏的上下文透镜摊开这一轮：主对话和每个成员各一个页签，左边逐次列出请求，右边是这次请求的缓存命中和断点对比">

## 能做什么

- **从对话直接打开**：每一轮回答下面多一个图标，点一下就跳到这一轮；会话顶部的图标打开最新一轮，「定位到最新 turn」随时回到最后。
- **看清请求里装了什么**：每次请求拆成系统提示、工具定义、历史和本次新增几块，系统提示每一段都标出来源，想看原文就展开。
- **知道缓存为什么断**：显示真实的缓存命中多少，再把和上一次请求不一样的地方精确到字标出来。
- **揪出重复内容**：点「只看重复」，把重复塞进去的同一段内容挑出来，只算多出来的那几份。
- **看时间花在哪**：切到「耗时分布」，总耗时拆成模型、工具执行和中间的空档，每个工具花了多久也能排序看。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-2.png" width="640" alt="「本次交换」：左边是这次新增的输入（助手消息和几条工具结果），右边是模型的输出和每个工具调用的参数">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-3.png" width="640" alt="「上下文构成」：一条彩色比例条，下面按系统、工具、历史、新增分组，每组的字符数，新增的几条逐条列出">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/context-lens-4.png" width="640" alt="「耗时分布」：本轮总耗时拆成模型调用、工具调用和其他，一条时间线按颜色标出模型思考、工具执行和空闲，下面是按合计排序的工具耗时表">

- **子 agent 也算得清**：委派出去的子 agent 单独列出来，主对话里不会把它的时间重复算一遍。
- **装之前的对话也能看**：打开时会从会话记录里补出插件装上之前的轮次。
- **只看不改**：它从不改动发给模型的请求，看到的数据只放在内存里，不写进会话。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-dev-suite
```

上下文透镜会跟着「开发套件」一起装好；「多Agent协作」（`@khorsheed/dsh-bundle-local-agent`）里也带着它。装完随便开一个会话，聊一轮，再点那一轮回答下面的图标就能看。

## 已知限制

- 正在进行中的那一轮不会实时刷新，要等它结束后重新打开。
- 从会话记录补出来的旧轮次，系统提示只能显示成一整块，分不出各段来源。
- 显示的是发出前组装好的内容，不是最终发到模型服务商那里的原始字节。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 入口：`src/index.ts`（采集与服务）、`src/client/index.ts`（右栏面板）；`examples/workbench/` 能用假数据单独预览面板（`pnpm exec tsx packages/context-lens/examples/workbench/serve.mts`）。
- 也可以单独安装（`dsh plugin --profile web add @khorsheed/dsh-context-lens`）；本包由旧的 request-inspector 改名而来，迁移时替换掉旧包，不要两个同时装。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
