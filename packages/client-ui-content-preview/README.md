# @khorsheed/dsh-client-ui-content-preview

[English](README.en.md) | 中文

「文件列表」「工作树」「会话产物」里那块看文件内容的面板。你不需要单独安装它：它已经内置在这三个插件里，装了其中任何一个就有。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/content-preview-1.png" width="640" alt="共享内容面板在 local-files 插件里的实际样子:markdown 渲染态、内容搜索、预览/源码切换">

## 它是什么

一个只在构建期使用的共享源码库（不发布，`private: true`）：三个插件预览文件用的是同一份实现，修一处，处处生效。它不注册任何东西，也没有自己的浏览器包，各插件直接引用源码，打包时内联进各自的 `lib/client.js`。

它提供：

- `ContentPane`：完整的内容面板——markdown、JSON 树、CSV 表格、代码高亮、图片，带标题栏操作、预览/源码切换和滚动记忆。
- `buildSrcDoc` / `attachBridge`：HTML 的分级沙箱和受控的对外能力桥。
- `structuredPreview`、`useRenderedSearch`：结构化预览，以及直接在渲染后的文档上高亮的内容搜索。

```ts
import { ContentPane, buildSrcDoc, attachBridge, structuredPreview, useRenderedSearch } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
```

文案全部由调用方用自己的字典传入，本包不持有任何 locale。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 各项能力的细节、HTML 沙箱与能力桥、契约面、已知限制和退休路径，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/client-ui-content-preview/docs/reference.md)里。
- 列表/详情布局 `AdaptiveSplit` 在 `@khorsheed/dsh-client-ui-panel-kit`。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
