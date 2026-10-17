# @khorsheed/dsh-video-studio

[English](README.en.md) | 中文

**剪辑台**：朋友间的聊天、播客、对谈，在 dsh 里剪。会话区商量「剪什么」，右栏「剪辑」面板管「怎么剪」，两边改的是同一份工程。

一群人围着一台录音笔录的一条混录，导入后自动分出每个人、拿节目里存的声纹认出常驻成员；文稿就是剪辑台——点一句剪掉，再点恢复；语气词、长停顿、说重复的由扫描找出来，作为一组提议等你 ✓。最后导出播客音频、带字幕的完整视频、SRT 和文稿。

## 特性

- **一条混录也能认人**——本机说话人分离（pyannote 分段 + CAM++ 声纹）找出几个声音；节目里存过的成员自动认出，新声音点 ▶ 听一段再起名，起名即存进节目，下次自动认。分错了可以合并两个声音，或把某一段改给别人。
- **删字就是删音频**——文稿按说话人分段着色，点一句剪掉、再点恢复；剪切按原始录音的时间记，不破坏原文件，导出前不重新编码。
- **成片 / 原始双视图**——默认只显示留下的内容（点句播放、拖选还能再剪，误剪有 6 秒撤销）；切到「原始」看所有划线标记、按来源过滤、点一下恢复。
- **暂停再继续也是一期**——多段录音按顺序拼成一条参考轴，转写、剪辑、导出无感；画面逐段自动对齐，文稿在接缝处有分隔。
- **边听边剪**——文稿 tab 底部的播放器按「剪后」成片或「原声」播放，当前段落和词跟随高亮、滚动跟随；你剪的和模型剪的用不同划线区分，可按来源过滤。转写错字拖选即可改，或全文替换（可存进节目，下期自动改）——只改文字和字幕，不动音频。
- **提议，不擅改**——模型的语气词/停顿/重复扫描和结构取舍都是一组虚线提议，你 ✓ 才生效；你在面板上的手动修改会以事件形式交给模型，它下一轮不会覆盖。
- **停顿缩短而不删**——长停顿默认缩到 0.6 秒，阈值可以按人设（说话慢的朋友阈值高一点）。
- **画面自动对齐**——手机拍的画面按声音波形和录音对齐，不需要拍手。
- **节目 → 工程**——节目存片头片尾、响度目标、字幕样式、剪辑习惯和声纹；新一期复制一份，「设置」tab 按「这期 / 节目 / 全局」三层显示每项来源，可存为节目默认或恢复。
- **导出**——MP3（两遍 loudnorm，默认 −16 LUFS）、1080p MP4（字幕烧录或可开关字幕轨，−14 LUFS）、SRT、TXT，后台任务，进度在面板和会话里都看得到。
- **剪辑模式**——`@khorsheed/dsh-presets` 的 `dsh-video` preset 授予 `video_*` 工具与 `video-studio` 技能。

## 安装

```bash
dsh plugin --profile web add @khorsheed/dsh-video-studio
dsh plugin --profile web add @khorsheed/dsh-presets   # 剪辑模式（dsh-video）
```

需要本机有 `ffmpeg` / `ffprobe`（在 PATH 上，或在面板「设置 → 全局」里填路径）。语音模型（约 360 MB：Paraformer 中文转写、CT-Transformer 标点、pyannote 分段、CAM++ 声纹）在第一次转写时自动下载到 `$DSH_HOME/state/video-studio/models/`，也可以在设置里手动下载。下载源可在「设置 → 全局」选择（自动选择 / Hugging Face / HF-Mirror 国内镜像，默认自动探测最快可达源），支持断点续传：进程重启或网络中断不丢已下载的字节，完成后按钉死的字节数与 sha256 校验。

卸载：

```bash
dsh plugin --profile web remove @khorsheed/dsh-video-studio
```

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：⚠️ 面板与宿主服务可用（右栏页型 tab 自 0.1.5 起），但剪辑模式 preset 行需要 0.1.7-rc.1 起的 preset 机制，0.1.5 上只能在通用会话里用面板。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.2.0-rc.1）——构建与测试在 0.2.0-rc.2 源码树下通过。
- **原生依赖**：`sherpa-onnx-node` 按平台带预编译原生插件（darwin-arm64 约 34 MB）。语音任务在独立子进程里跑，原生插件加载失败只让转写任务失败，不影响启动。
- **ffmpeg 版本**：只用 4.2 起就有的滤镜（atrim / concat / loudnorm / afftdn）。没有 libass（`subtitles` 滤镜）的 ffmpeg 导出视频时改为可开关字幕轨，面板会提示。
- **Web 表面**：右栏 tab 是浏览器表面；headless profile 上只有宿主服务和工具。

## 已知限制

- **混录不能只剪一个人**——剪一段就是这段时间所有人一起剪；抢话、附和默认保留。人声分离放在后续版本。
- **只支持混录**——每人一支麦的多轨录音还没做（数据模型已留口子：说话人可以来自某条轨）。
- **素材按路径导入**——面板里填本机路径或在会话里给路径；浏览器拖入上传还没做。
- **预览是短片段**——面板里的 ▶ 播放一段（≤ 30 秒，已应用剪辑）；完整时间线、波形、音量包络在下一版。
- **分人准确率取决于录音**——离录音笔远、声音相近、抢话多的录音会分错，需要在面板里合并或改段。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**工程正本。** `$DSH_HOME/state/video-studio/projects/<id>/project.json` 是唯一正本：素材只记路径；所有编辑都是参考录音时间轴上的区间（`cut` / `shorten`），带 `proposed | applied | rejected` 状态和提议组。成片时间 = 参考时间轴减去已生效的剪切与缩短，导出、字幕、时长全部由此推出。写入是原子的（临时文件 + rename），同一工程的读改写串行。

**媒体任务。** 对齐、分人转写、导出是宿主任务队列里的任务，一次跑一个，持久化在 `jobs.json`，重启后重新排队。分人与转写在 `child_process.fork` 出来的子进程里跑（sherpa-onnx 的解码是同步原生调用，不能占住宿主事件循环）：整段分人 → 合并同一人的相邻片段 → 长段在最安静处切成 ≤ 25 秒 → Paraformer 逐段转写（带逐字时间戳）→ 标点模型补标点并挂回逐字 → 每个声音取最多 60 秒算一个声纹，与节目声纹做余弦比对。

**导出。** 按保留区间生成 ffmpeg 滤镜脚本（`atrim`/`trim` + `concat`，每个切口 20 ms 淡入淡出），音频走两遍 loudnorm；视频在 concat 之后统一 `fps=30` 再烧字幕。

**两个面。** 面板经 namespace `videoStudio` 的 Typert Remote 调宿主服务；模型经 `./tool` 入口的 `video_*` 工具调同一个服务。面板上的修改写进工程的 `events`，`video_read` 把模型上次读取以来的事件一起交给它。

</details>

## 开发

```bash
pnpm --filter @khorsheed/dsh-video-studio build
pnpm --filter @khorsheed/dsh-video-studio test
# 手动冒烟（需要已下载的模型）：
pnpm exec tsx packages/video-studio/tests/smoke/smoke-service.ts <录音> [视频]
```

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
