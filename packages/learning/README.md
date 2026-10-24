# @khorsheed/dsh-learning-suite

[English](README.en.md) | 中文

自学用的模式：agent 当你的读书教练，一本书、一门课陪你读完；读到哪、哪里没懂、哪道题错过，它都替你记着。

以前用 agent 学东西，聊完就散了：读到第几章、哪个概念没吃透、上次哪道题答错，下次都得重新交代一遍。切到学习模式，你说想学什么，教练先问问你的底子，再帮你挑教材、排路线；你读的时候拍一页书，它把划线整理成卡片；学完一章做个小测，错题留到你订正对为止。读到的文章和播客，也能让它考考你，再用自己的话写成卡片。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-learning-hero.png" width="640" alt="学习模式的会话：左边是和读书教练的对话，右栏图书馆显示今天要继续学的、到期要复习的和每本教材的进度">

## 可以这样跟 agent 说

- 「我想三个月入门线性代数，先问问我的底子，再帮我挑教材、排路线。」
- 「这是第二章第 3 页的照片，把我划线的地方记成卡片。」
- 「给第二章出一套小测。」
- 「考考我昨天在灵感空间读的那篇文章。」
- 「把这一节的要点用我的话写成一张画布卡，你帮我挑挑毛病。」

## 里面有什么

- **图书馆**：右栏的学习台。教练帮你排路线（你点「采用」才算数）、把拍的书页变成卡片、出章节小测，今日页列好该继续的和该复习的。
- **灵感画布**：读完用自己的话写成卡片，写出来才算真懂。
- **灵感空间**：订阅、收藏文章来读，记笔记、带着笔记讨论，读完点「让Agent考考我」。
- **本机转写**：没有字幕的视频、播客，在你电脑上转成文字再读。
- **渲染抓取**：要靠脚本才显示得出来的网页，也能把正文抓下来。

教练是陪你读，不是替你读：会的跳过，薄弱的放慢；你不指定教材，它会挑一本现成的书或课程，实在没有合适的就自己编一份。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-learning-suite
```

最好再装一个 `@khorsheed/dsh-basic`（基础体验），改消息、看文件这些日常功能在那里。装完开一个新会话，选「学习模式」，告诉教练你想学什么。

这些功能只在学习模式的会话里出现，在其它模式里看不到是正常的（画布和灵感空间在写作模式里也有）。

## 已知限制

- 不读书的电子文件（EPUB、PDF），书的内容靠你拍的照片。
- 本机转写需要电脑上装有 ffmpeg，第一次转写要先下载语音模型。

## Compatibility

需要 DSH 0.1.7 或更新版本，已在 0.2.1 上验证。

## 给开发者

命令行安装（和上面效果一样）：

<!-- collection:start -->
推荐连同基础体验一起装(「学习」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-learning-suite
```
<!-- collection:end -->

- 本包自己不带功能，只负责把学习模式和上面这些成员一起装上；卸载（`dsh plugin --profile web remove @khorsheed/dsh-learning-suite`）也是一起移除，只想关一个就在套件详情页里单独关。
- 每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
