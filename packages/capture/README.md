# @khorsheed/dsh-capture

[English](README.en.md) | 中文

灵感空间的协作插件，帮你把想看的文章拉回来，对一些布局比较复杂的网页做了单独的优化和适配。

## 能做什么

- **手动再试一次**：觉得正文不全，点文章里的「渲染抓取」，让它用浏览器重新抓。
- **滚到底才出现的图也在**：它会把页面从头滚到尾，等懒加载的内容都出来；脚本画的交互图会存成一张静态图。
- **图的颜色跟着走**：原页面给插图、图表配的颜色一起带回来，不会变成一片黑白。
- **不带你的登录**：每次都是一个干净的浏览器，不带 Cookie、不记任何登录信息；内网和本机地址一律不去。
- **不用就不占地方**：第一次用到时才下载浏览器，闲下来一分钟就自己关掉。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-learning-suite
```

渲染抓取会跟着「学习套件」和灵感空间一起装好——它是给灵感空间用的，单独装没有可用的地方。装完照常在灵感空间里打开链接就行。

## 已知限制

- 第一次用会先下载浏览器，比较慢；之后每次约 15–30 秒。
- 需要登录才能看的页面，抓回来的就是登录页。
- 带回来的是静态页面：按钮、输入框、展开这些都不能再点；特别长的页面只抓到一定长度。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 对外接口（`capture.render`）、配置项、渲染流程、地址安全检查和威胁模型、本地测试方式，见[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/capture/docs/reference.md)。
- 也可以单独安装：在「添加插件」里输入 `@khorsheed/dsh-capture`，或 `dsh plugin --profile web add @khorsheed/dsh-capture`；没有装灵感空间时它没有界面，也不会被用到。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
