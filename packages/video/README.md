# @khorsheed/dsh-video-suite

[English](README.en.md) | 中文

剪播客和对谈的模式：一条混录自动分出每个人，文稿就是剪辑台，删一句话就是删掉那段音频。

以前剪一期朋友间的对谈，要在剪辑软件里对着波形找每个人说的话，一刀一刀删语气词和长停顿。切到剪辑模式，你把录音交给它，它分出几个声音、认出常驻的主持；文稿按说话人着色，点一句就剪掉。哪些语气词、停顿、重复该删，agent 扫一遍列成一组提议，你点头才动。最后导出播客音频、带字幕的视频和 shownotes。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-video-hero.png" width="640" alt="剪辑模式的会话：左边对话里是 agent 给出的一组剪辑提议，右栏剪辑面板显示按说话人着色的文稿与播放器">

## 可以这样跟 agent 说

- 「导入这期录音，分出几个人，认一下是不是常驻的两位主持。」
- 「把语气词和说重复的地方找出来，给我一组提议。」
- 「开头十分钟太散了，你建议怎么剪？」
- 「导出 MP3 和带字幕的 MP4，再写一份 shownotes。」

## 里面有什么

- **剪辑**：右栏的「剪辑」面板。文稿点一句剪掉、再点恢复，剪错了能撤销；长停顿缩短而不是删掉；边听边剪，当前的词跟着高亮；手机拍的画面按声音自动对齐，不用拍手；每档节目的片头片尾、字幕样式、声纹存一次，每期都沿用。
- **本机转写**：在你电脑上把录音转成文字，并分出谁在说话。
- **本机编码工具**（Kimi、Codex、Claude Code，还有默认关着的本机 DSH 委派）：活多的时候，把一部分交给它们。
- **协作间**：请几个 agent 进同一个会话，一起做一期节目。

导出在后台跑，进度在面板和会话里都看得到；能导出 MP3、1080p MP4（字幕烧进画面或做成可开关的字幕轨）、SRT 字幕和文稿。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-video-suite
```

最好再装一个 `@khorsheed/dsh-basic`（基础体验），改消息、看文件这些日常功能在那里。装完开一个新会话，选「剪辑模式」，告诉 agent 录音文件在哪。

这些功能只在剪辑模式的会话里出现，在其它模式里看不到是正常的。

## 已知限制

- 需要电脑上装有 ffmpeg；第一次转写会先下载约 360 MB 的语音模型。
- 混录里剪一段，就是这段时间所有人一起剪；每人一支麦的多轨录音还不支持。
- 素材要给本机路径，还不能拖进浏览器上传。

## Compatibility

需要 DSH 0.1.7 或更新版本，已在 0.2.1 上验证。

## 给开发者

命令行安装（和上面效果一样）：

<!-- collection:start -->
推荐连同基础体验一起装(「剪辑」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-video-suite
```
<!-- collection:end -->

- 本包自己不带功能，只负责把剪辑模式和上面这些成员一起装上；卸载（`dsh plugin --profile web remove @khorsheed/dsh-video-suite`）也是一起移除，只想关一个就在套件详情页里单独关。
- 每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
