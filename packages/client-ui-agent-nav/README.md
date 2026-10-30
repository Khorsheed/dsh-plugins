# @khorsheed/dsh-client-ui-agent-nav

[English](README.en.md) | 中文

让各个模式插件在「模型刚写了东西」时，用同一种方式把你带到那个位置。你不需要单独安装它：画布、长篇小说等插件已经把它内置进去了。

## 它是什么

一个只在构建期使用的共享源码库（不发布，`private: true`）。它不注册任何东西，各插件以 `workspace:*` 依赖它、直接引用源码，打包时内联进各自的 `lib/client.js`。

它提供：

- **去向行**：写入类工具在回答末尾加一行 `⟦dsh-nav⟧{…}`，说明刚写的东西在哪个面板、哪个位置（比如「画布 · 章节 · 第 3 章 · 看计划」）。`readDestinations` 读出它，`stripDestinations` 在卡片上把它藏起来。
- **唯一的跟随规则** `decideFollow`：只有你在看这个会话、亲眼看着这次调用完成、20 秒内没在面板里操作、窗口不窄、这个回合还没跳过时，侧栏才自己过去；否则只亮小点，等你点卡片。
- **跟随器** `startNavFollower`：监听屏幕上那个会话的实时事件，按上面的规则打开或标记；每次判断打一行 `[nav] dest=… decision=… reason=…` 日志。
- **`interactionHandlers`**：挂在面板根节点上，让「你正在面板里操作」被跟随器看见。

```ts
import { followerHostOf, startNavFollower, interactionHandlers } from '@khorsheed/dsh-client-ui-agent-nav/src/client/index.ts'
```

## Compatibility

需要 DSH 0.2.0-rc.1 或更新版本，已在 0.2.1-rc.3 上验证。宿主缺少右栏 `mounted` 或会话事件窗口时，跟随器不启动，插件只保留会话里的卡片。

## 给开发者

契约正本见 [docs/agent-nav.md](https://github.com/Khorsheed/dsh-plugins/blob/main/docs/agent-nav.md)。
