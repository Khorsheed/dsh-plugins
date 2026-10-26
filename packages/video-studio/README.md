# @khorsheed/dsh-video-studio

[English](README.en.md) | 中文

剪播客和对谈：录音变成文稿，删一句话就剪掉一段，嗯嗯啊啊和长停顿 agent 帮你找。

几个朋友围着一支录音笔聊了一小时，以前要在剪辑软件里对着波形一点点找谁在说话、一刀刀切语气词。装上之后，你把录音交给它，它转成文稿、分出每个人；你在文稿上点一句就剪掉一句，剪什么在会话里和 agent 商量，它找出来的地方都等你点头。最后导出成品音频、带字幕的视频和字幕文件。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-2.png" width="640" alt="「文稿」页：按说话人分段的文字稿，选中一段弹出「从这里播放」「剪掉」「改字…」，上方是查找替换、扫描语气词和停顿、AI 帮改，底部播放器可切剪后和原声">

## 能做什么

- **一条混录也能分人**：几个人共用一支麦也没关系，它自动分出几个声音；给新声音起一次名字，同一档节目下次就自动认出来。
- **删字就是剪音频**：点一句剪掉，再点恢复；原始录音不会被改动。
- **啰嗦的地方它来找**：语气词、长停顿、说重复的，agent 扫一遍列成一组，你点「采纳」才算数；长停顿是缩短，不是一刀删光。
- **边听边剪**：底部播放器可以听「剪后」也可以听「原声」，播到哪句高亮到哪句；转写错的字直接改，只改文字和字幕，不动声音。
- **让 agent 帮你过一遍**：点「AI 帮改」，它把请求填进会话输入框，你补一句想重点处理什么再发；它改的照样等你确认。
- **一键导出**：播客音频、完整视频、字幕、文稿，想要的勾上就行；shownotes 直接让 agent 在会话里写给你。
- **节目记住你的习惯**：片头片尾、音量、字幕样式和常驻成员的声音都存在节目里，新一期直接沿用。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-1.png" width="640" alt="「素材」页：一条带画面的录音，认出 5 个声音，每个声音一行，带时长、▶ 听和「合并到…」">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-3.png" width="640" alt="「设置」页：这期、节目、全局三层，音频和视频响度、片头片尾音乐、字幕样式、停顿和语气词，每项可以「沿用节目」">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-video-suite
```

剪辑会跟着「剪辑套件」一起装好。装完开一个新会话，选「剪辑模式」，告诉 agent 录音放在哪里。右栏的开始页里点「剪辑」就能打开它。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-0.png" width="640" alt="右栏的开始页：会话产物、文件列表、Context Lens 之下就是「剪辑」入口">

「剪辑」只在剪辑模式的会话里出现，在其它模式里看不到它是正常的。

## 已知限制

- 混录里剪一段，就是这段时间所有人一起剪掉，没法只剪其中一个人。
- 录音不能拖进来上传，要选文件夹或填这台电脑上的路径。
- 需要这台电脑装有 `ffmpeg`；第一次转写还要先下载约 360 MB 的语音模型。

## Compatibility

需要 DSH 0.1.5 或更新版本，已在 0.2.1 上验证。

## 给开发者

- 入口：`src/index.ts`（服务）、`src/client/`（侧栏）、`src/tool.ts`（agent 用的工具和技能）。
- 也可以单独安装本包（`dsh plugin --profile web add @khorsheed/dsh-video-studio`），但它的工具要由某个模式授予，单装时侧栏不会出现；分人和转写还要装 [本机转写](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/transcribe/README.md)。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
