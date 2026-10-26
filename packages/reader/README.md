# @khorsheed/dsh-reader

[English](README.en.md) | 中文

把想读的文章、视频、播客收在一面墙上，就在 DSH 里读、记笔记，再和 agent 一起把它读透。

刷到的论文、文章、视频散落在浏览器标签页里，想跟 agent 聊还得复制粘贴，聊完也没留下什么。装上灵感空间，把链接粘进来、或订阅一个 RSS，右侧栏「灵感空间」里就多一张卡片；点开就能读，外文一键翻成中文。读到要紧的句子划一下记成笔记，带着笔记跟 agent 讨论，最后让它考考你讲不讲得清楚，结论都记回笔记里。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-1.png" width="640" alt="灵感空间的墙:订阅与保存链接的卡片流,表头一行是筛选、排序、整墙翻译、刷新、设置与新增,搜索框独占一行">

## 能做什么

- **粘个链接就收下**：点「新增灵感」粘进来，是订阅源就订阅、是文章就存一篇；订阅每天自动刷新，转载的同一篇只留一张卡。抓不到的也会存下，并写明原因。
- **视频和播客也能读**：YouTube、B 站、播客和小宇宙都能放进来；有字幕就用字幕，没字幕就在本机转写成「转写稿」，多人对谈还会分出谁在说话。点一段时间就从那里播放。
- **外文一键翻成中文**：按句翻，点一句看原文；不满意机翻，点「让 Agent 润色译文」，它整篇重译一遍。
- **划一句就记笔记**：选中句子点「记笔记」，存下原文和你的想法；记过的句子在正文里有底色，点笔记能跳回原处。
- **带着笔记讨论**：点「带着笔记讨论」，笔记进了输入框，你发出去就能和 agent 聊；聊出的结论让它记回那条笔记下。
- **让 agent 考考我**：读完点「让Agent考考我」，它扮成没读过的学生，请你讲给它听，再对照原文只指出你没讲到位的地方。不打分，想再练就再点一次。
- **引用进对话**：选中正文能直接引用进输入框；装了灵感画布，笔记还能「同步到画布」变成一张灵感卡。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-2.png" width="640" alt="详情页:正文以 DOM 文本渲染,地球开关点亮后按句对照翻译,点一句展开该句原文">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面任一个套件的包名，点安装：

```
@khorsheed/dsh-writing-suite
```

```
@khorsheed/dsh-learning-suite
```

灵感空间会跟着「写作套件」或「学习套件」一起装好，本机转写和渲染抓取也一并带上。装完开一个新会话，选「写作模式」或「学习模式」，在右侧栏打开「灵感空间」，粘进第一个链接。

灵感空间只在这两个模式的会话里出现，在其它模式里看不到它是正常的。

## 已知限制

- 一键翻译用的是浏览器自带的翻译，只有电脑上的 Chrome 138+ / Edge 148+ 能新翻；手机和其它浏览器只能看已经翻好的。
- PDF 读不了正文，只能存成链接；要登录才能看的页面也抓不到。
- 很长的文章可能只抓到一部分，这时会提示，并给「阅读原文」。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 全部功能细节、各个面、抓取 / 翻译 / 存储的内部机制、降级和存储位置，见[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/reader/docs/reference.md)。
- 入口：`src/index.ts`（服务与侧栏）、`src/tool.ts`（`reader_read` 等模型工具）。也可以单独安装（`@khorsheed/dsh-reader`，或 `dsh plugin --profile web add @khorsheed/dsh-reader`），这时它在所有会话里都可见；本机转写和渲染抓取要另外装 `@khorsheed/dsh-transcribe`、`@khorsheed/dsh-capture`。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
