# @khorsheed/dsh-writing-suite

[English](README.en.md) | 中文

和 agent 一起写东西的模式：灵感和成稿都落在画布上，写长篇它记得人物和伏笔，读到的好文章随手记笔记、再拿来聊。

以前和模型写长篇，人物、伏笔、章节计划散在几个文档里，每开一次新对话都得把背景重新贴一遍；看到好文章，也只能复制粘贴进对话。切到写作模式，你只管和 agent 聊想法、要稿子，它把灵感、人物、伏笔一张张记成右栏画布上的卡片，提议先摆出来等你点头；章节你审过了才算数。下次再来，背景都在板上，接着写就行。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-writing-hero.png" width="640" alt="写作模式的会话：左边是对话，右栏画布上排着灵感、人物与伏笔卡片，其中一张是模型提议、等你确认的卡">

## 可以这样跟 agent 说

- 「新建一块画布叫《雾港》，把刚聊的三个人物各写成一张人物卡。」
- 「按章节计划写第三章，写完先给我审。」
- 「把这段改得口语一点，事实和观点别动。」
- 「读一下我刚打开的那篇文章，结合我的笔记聊聊它的论点，结论记到笔记里。」
- 「这条伏笔什么时候揭晓比较好？」

## 里面有什么

- **灵感画布**：一个主题一块画布，灵感、问题、共识、来源、成稿都是卡片；agent 提议的卡你点 ✓ 才留下。
- **长篇小说**：把画布设成「长篇小说」，人物、世界、伏笔都有自己的卡，每对人物一张关系卡，章节你审过才收进去。
- **灵感空间**：订阅、收藏文章，在 DSH 里直接读；划一句就记笔记，带着笔记和 agent 讨论，笔记还能变成画布上的卡片。
- **本机转写**：没有字幕的视频、播客，在你电脑上转成文字，再到灵感空间里读。
- **渲染抓取**：要靠脚本才显示得出来的网页，也能把正文抓下来。

agent 写东西时会先分清你是要写、要分析还是要改稿；改稿只动表达，不动你的事实和观点。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-writing-suite
```

最好再装一个 `@khorsheed/dsh-basic`（基础体验），改消息、看文件这些日常功能在那里。装完开一个新会话，选「写作模式」，告诉 agent 你想写什么。

这些功能只在写作模式的会话里出现，在其它模式里看不到是正常的。

## 已知限制

- 本机转写需要电脑上装有 ffmpeg，第一次转写要先下载语音模型。
- 灵感空间的翻译用的是浏览器自带的翻译，要用支持它的桌面浏览器。

## Compatibility

需要 DSH 0.2.0 或更新版本，已在 0.2.1 上验证。

## 给开发者

命令行安装（和上面效果一样）：

<!-- collection:start -->
推荐连同基础体验一起装(「写作」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-writing-suite
```
<!-- collection:end -->

- 本包自己不带功能，只负责把写作模式和上面这些成员一起装上；卸载（`dsh plugin --profile web remove @khorsheed/dsh-writing-suite`）也是一起移除，只想关一个就在套件详情页里单独关。
- 每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
