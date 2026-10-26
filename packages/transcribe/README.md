# @khorsheed/dsh-transcribe

[English](README.en.md) | 中文

在这台电脑上把长录音转成带时间的文字，还能分出谁在说话。

一期两小时的播客、一段没字幕的视频，想拿到文字稿，以前要么上传到网上的服务，要么自己听写。本机转写在你的电脑上把它转出来，每句话都带时间，多人对谈还能分出谁在说。你不用直接操作它：在「剪辑」里做分人与转写，或在「灵感空间」里给没字幕的视频和播客出文稿时，用的都是它。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/reader-transcript.png" width="560" alt="灵感空间里一段 B 站视频的本机转写稿：上面是视频，下面按说话人 A、B 分段，每段前面有时间，点时间从那里播放，译文跟在原文下面">

## 能做什么

- **长录音转成带时间的文字**：每一句都标着从第几秒开始到第几秒结束，回头对原声很方便。
- **分出谁在说话**：对谈、访谈能按说话人分开；认识的声音还能直接认出来。
- **中英文都行**：中文、英文都能转，也可以让它自己判断是哪种语言。
- **边转边出**：转完一段就先给出一段，不用等整期结束。
- **不离开你的电脑**：识别在本机完成，录音不上传；临时音频转完就删。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面任意一个套件的包名，点安装：

```
@khorsheed/dsh-learning-suite
```

```
@khorsheed/dsh-video-suite
```

本机转写会跟着「学习套件」或「剪辑套件」一起装好。装完不用做任何设置，在剪辑或灵感空间里需要转写时它会自动出场。

## 已知限制

- 电脑上要装有 `ffmpeg`，否则需要先解码的录音转不了。
- 第一次用到某种语言或分人时，要先下载对应的语音模型，会等一会儿。
- 同一时间只转一个任务，其它的排队。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 它只提供一个宿主服务 `transcribe`，没有侧栏，也没有给 agent 的工具；调用方式、方法、语种与模型、配置项都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/transcribe/docs/reference.md)里。用之前先 `ctx.get('transcribe')` 探测，没装时提示并降级。
- 入口：`src/index.ts`（服务）、`src/speech-worker.ts`（识别子进程）。也可以单独安装：`dsh plugin --profile web add @khorsheed/dsh-transcribe`。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
