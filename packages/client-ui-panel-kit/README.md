# @khorsheed/dsh-client-ui-panel-kit

[English](README.en.md) | 中文

让插件面板在电脑和手机上都好用的共享底座。你不需要单独安装它：「灵感画布」「图书馆」「灵感空间」「剪辑」「游戏开发」「上下文透镜」「文件列表」「工作树」「会话产物」等插件已经把它内置进去了。

## 它是什么

一个只在构建期使用的共享源码库（不发布，`private: true`）。目标是让每个插件**只写一套界面**，按自己拿到的面板宽度自适应——桌面拖窄的侧栏、浮窗和手机用同一份代码。它不注册任何东西，各插件以 `workspace:*` 依赖它、直接引用源码，打包时内联进各自的 `lib/client.js`。

它提供：

- **字号变量**：`--dsh-panel-*`，总是带桌面默认值读取；装了 `@khorsheed/dsh-mobile` 时在触屏上调大，插件不依赖 mobile。
- **`PanelRoot` / `usePanelCompact`**：声明面板尺寸容器，`@container dsh-panel (max-width: 560px)` 进入紧凑排版。
- **常用控件**：`PanelHeader`（放不下的操作收进「…」）、`UnderlineTabs`、`ChipRow`、`ListRow`、列表/详情布局 `AdaptiveSplit`。
- **`browserOnHost()`**：判断页面是不是在宿主电脑本机打开，用来隐藏远程访问时没意义的操作。

```ts
import { PanelRoot, PanelHeader, UnderlineTabs, ChipRow, ListRow, panelVar } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
```

所有可见文字和无障碍名称都由调用方传入；颜色只用宿主的 `--dsw-alias-*` 变量，深浅主题自动跟随。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 字号变量的默认值、每个组件的行为与参数，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/client-ui-panel-kit/docs/reference.md)里；面板设计规范见 [docs/panel-design.md](https://github.com/Khorsheed/dsh-plugins/blob/main/docs/panel-design.md)。
- 仓库根运行 `node packages/client-ui-panel-kit/examples/adaptive-split/serve.mjs` 可看 `AdaptiveSplit` 的独立预览。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
