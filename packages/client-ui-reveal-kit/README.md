# @khorsheed/dsh-client-ui-reveal-kit

[English](README.en.md) | 中文

agent 做完一件事、或者想请你看某个地方时，让插件面板自己跳过去——但你正在面板里忙的时候不打扰。你不需要单独安装它：「游戏」等插件已经把它内置进去了。

## 它是什么

一个只在构建期使用的共享源码库（不发布，`private: true`），和面板底座 `@khorsheed/dsh-client-ui-panel-kit` 同一种形态：各插件以 `workspace:*` 依赖它、直接引用源码，打包时内联进各自的 `lib/client.js`，不注册任何东西。

它提供：

- **`RevealController`**：决定「跳过去」还是「只提示」。你正在用的东西（在播放、在试玩）、20 秒内在面板里点过或敲过键、正看着另一个条目时只提示；面板关着且窗口窄于 820 像素时不打开；每个浏览器一个开关（默认开）。每次决定在浏览器控制台留一行 `[reveal:插件名] …`，方便查「为什么没跳」。agent 的请求按编号只处理一次，刷新页面时看到的旧请求不处理。
- **`visiblePoll`**：只在页面可见时轮询，会话事件可以提前「推」一下。插件的服务端没法主动推到页面，协作间成员干活时主会话也不产生事件，所以要靠页面自己看。
- **`RevealNoticeBar`**：被拦下的跳转显示成面板顶部的一条提示（「去看看 / 不用了」）。

```ts
import { RevealController, RevealNoticeBar, visiblePoll } from '@khorsheed/dsh-client-ui-reveal-kit/src/client/index.ts'
```

所有可见文字由调用方传入；颜色只用宿主的 `--dsw-alias-*` 变量。

## 服务端那一半（各插件自己写）

插件的服务端只编译自己的源码，所以这一半是约定，不是共享代码，十几行：

1. 注册一个自己的工具，名字带插件前缀（如 `game_show`），参数是自己面板里的位置，再加一句 `note`（看什么）。
2. 工具把请求记在内存里：按项目（或书、工程）存最新一条 `{ seq, target, note, at }`，`seq` 递增。
3. 页面轮询的那个 Remote 顺带返回这条请求；页面调用 `controller.request(项目, seq, target, 文字, 是否刚发生)`。

游戏插件是第一个接入的例子：`packages/game/src/store.ts` 的 `requestShow` / `liveVersion`，`src/tools.ts` 的 `game_show`，`src/client/autonav.ts`。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 宿主还没有「agent 请界面显示某处」的原生通道（服务端推送）；有了之后，`visiblePoll` 这一层换成宿主通道即可，各插件的工具不变。登记在 [docs/upstream-seam-registry.md](https://github.com/Khorsheed/dsh-plugins/blob/main/docs/upstream-seam-registry.md)。
