# @khorsheed/dsh-video-studio

[English](README.en.md) | 中文

朋友间的聊天、播客、对谈，在 dsh 里剪：改文稿就是剪音频，分人、认人、语气词和停顿都有人帮你找。

一群人围着一台录音笔录下一条混录，以前要在剪辑软件里对着波形一点点找、一点点切。现在导入这条录音，插件自动分出每个人、拿节目里存的声纹认出常驻成员；文稿就是剪辑台——点一句剪掉，再点恢复；语气词、长停顿、说重复的由扫描找出来，作为一组提议等你 ✓。会话区商量「剪什么」，右栏「剪辑」面板管「怎么剪」，两边改的是同一份工程。最后导出播客音频、带字幕的完整视频、SRT 和文稿。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-transcript.png" width="640" alt="右栏「剪辑」面板的文稿页：按说话人着色的段落，有删除线的剪切和虚线的提议，底部是播放器">

## 特性

- **导入一条混录**——在面板里选文件夹勾选素材，或填本机路径、在会话里给路径；暂停后再继续录的几段可以勾「连续录制」按顺序拼成一期，转写、剪辑、导出都感觉不到接缝。手机拍的画面按声音波形和录音自动对齐，不需要拍手。
- **自动分人，节目声纹认人**——本机说话人分离找出几个声音；节目里存过的成员自动认出，新声音点 ▶ 听一段再起名，起名即存进节目，下次自动认。分错了可以合并两个声音，或把某一段改给别人。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-speakers.png" width="640" alt="分人结果：每个声音一行，已认出的成员带名字，新声音带 ▶ 试听与起名框">

- **删字就是删音频**——文稿按说话人分段着色，点一句剪掉、再点恢复；剪切按原始录音的时间记，不破坏原文件。默认「成片」视图只显示留下的内容（误剪有 6 秒撤销），切到「原始」看所有划线、按来源过滤、点一下恢复。
- **停顿缩短而不删**——长停顿默认缩到 0.6 秒，阈值可以按人设（说话慢的朋友阈值高一点）。
- **边听边剪**——底部播放器按「剪后」成片或「原声」播放，当前段落和词跟随高亮；你剪的和模型剪的用不同划线区分。转写错字拖选即可改，查找栏里可逐处或全文替换——只改文字和字幕，不动音频。
- **提议，不擅改**——模型的语气词 / 停顿 / 重复扫描、校稿改字、结构取舍都是一组虚线提议，你 ✓ 才生效；「AI 帮改」把校稿或精简需求填进会话输入框（只填不发）。你在面板上的修改会交给模型，它下一轮不会覆盖。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-proposals.png" width="640" alt="文稿里的一组虚线提议（语气词与长停顿），带 ✓ 接受与拒绝按钮">

- **导出音频、视频、字幕、文稿**——MP3（默认 −16 LUFS）、1080p MP4（字幕烧录或可开关字幕轨，−14 LUFS）、SRT、TXT，可以混入垫乐；后台导出，进度在面板和会话里都看得到。shownotes 由 agent 在会话里写给你。
- **节目 → 工程**——节目存片头片尾、响度目标、字幕样式、剪辑习惯和声纹；新一期复制一份，「设置」页按「这期 / 节目 / 全局」三层显示每项来源，可存为节目默认或恢复。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/video-studio-export.png" width="640" alt="「导出」页：勾选播客音频、完整视频、字幕、文稿，选择保存位置，下方是导出进度">

分人与转写跑在公共的本机转写插件 [`@khorsheed/dsh-transcribe`](https://github.com/Khorsheed/dsh-plugins/tree/main/packages/transcribe) 上，全程在本机，不上传录音。

## 安装

推荐装剪辑套件，连同基础体验一起：

```bash
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-video-suite
```

装好后重启实例，在会话的模式选择器里切到「剪辑模式」：会话拿到 `video_*` 工具与 `video-studio` 技能，右栏出现「剪辑」。

进阶：只装本包。

```bash
dsh plugin --profile web add @khorsheed/dsh-video-studio
```

单装时宿主服务在，但 `video_*` 工具只由剪辑模式按会话授予，不会出现在其它会话；「剪辑」面板也按会话自隐，只在拿得到这些工具的会话里出现（标准模式下隐藏）。所以单装要配合一个授予 `@khorsheed/dsh-video-studio/tool` 的模式使用。卸载用对应的 `remove`。

**本机依赖：**

- `ffmpeg` / `ffprobe`：在 PATH 上，或在面板「设置 → 全局」里填路径。
- 分人与转写由「本机转写」插件（`@khorsheed/dsh-transcribe`）完成，需要一起安装；没装时面板会提示，剪辑与导出照常可用。语音模型（约 360 MB：Paraformer 中文转写、CT-Transformer 标点、pyannote 分段、CAM++ 声纹）由它在第一次转写时自动下载到 `$DSH_HOME/state/transcribe/models/`（以前剪辑插件下载过的模型会自动挪过去），也可以在设置里手动下载。下载源可在「设置 → 全局」选择（自动选择 / Hugging Face / HF-Mirror 国内镜像，默认自动探测最快可达源），支持断点续传：进程重启或网络中断不丢已下载的字节，完成后按钉死的字节数与 sha256 校验。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：⚠️ 面板与宿主服务可用（右栏页型 tab 自 0.1.5 起），但剪辑模式 preset 行需要 0.1.7-rc.1 起的 preset 机制，0.1.5 上只能在通用会话里用面板。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.2.1-rc.1）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化。
- **转写引擎是可选插件**：分人与转写跑在「本机转写」插件（`transcribe` 服务）上，每次转写时探测；没装时面板提示、转写任务报这一句，剪辑与导出不受影响。原生依赖 `sherpa-onnx-node` 跟着它走，本插件不再带。
- **ffmpeg 版本**：只用 4.2 起就有的滤镜（atrim / concat / loudnorm / afftdn）。没有 libass（`subtitles` 滤镜）的 ffmpeg 导出视频时改为可开关字幕轨，面板会提示。
- **Web 表面**：右栏 tab 是浏览器表面；headless profile 上只有宿主服务和工具。

## 已知限制

- **混录不能只剪一个人**——剪一段就是这段时间所有人一起剪；抢话、附和默认保留。人声分离放在后续版本。
- **只支持混录**——每人一支麦的多轨录音还没做（数据模型已留口子：说话人可以来自某条轨）。
- **素材不能拖入上传**——只能选文件夹或填本机路径（「选择文件夹」只在页面从宿主机本机打开时显示）；浏览器拖入上传还没做。
- **预览是短片段**——面板里的 ▶ 播放一段（≤ 30 秒，已应用剪辑）；完整时间线、波形、音量包络在下一版。
- **分人准确率取决于录音**——离录音笔远、声音相近、抢话多的录音会分错，需要在面板里合并或改段。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**工程正本。** `$DSH_HOME/state/video-studio/projects/<id>/project.json` 是唯一正本：素材只记路径；所有编辑都是参考录音时间轴上的区间（`cut` / `shorten`），带 `proposed | applied | rejected` 状态和提议组。成片时间 = 参考时间轴减去已生效的剪切与缩短，导出、字幕、时长全部由此推出。写入是原子的（临时文件 + rename），同一工程的读改写串行。

**媒体任务。** 对齐、分人转写、导出是宿主任务队列里的任务，一次跑一个，持久化在 `jobs.json`，重启后重新排队。分人与转写调用本机转写插件的 `transcribe` 服务（每次任务时探测）：整段分人（pyannote 分段 + CAM++ 声纹）→ 合并同一人的相邻片段 → 长段在最安静处切成 ≤ 25 秒 → Paraformer 逐段转写（带逐字时间戳）→ 标点模型补标点并挂回逐字 → 每个声音取最多 60 秒算一个声纹，与节目声纹做余弦比对。

**导出。** 按保留区间生成 ffmpeg 滤镜脚本（`atrim`/`trim` + `concat`，每个切口 20 ms 淡入淡出），音频走两遍 loudnorm；视频在 concat 之后统一 `fps=30` 再烧字幕。

**两个面。** 面板经 namespace `videoStudio` 的 Typert Remote 调宿主服务；模型经 `./tool` 入口（行 id `video-studio-tool`）的 `video_*` 工具调同一个服务，这一行只由 `@khorsheed/dsh-video-suite` 的 `dsh-video` preset（剪辑模式）按会话授予，从不挂在 profile 根上。面板上的修改写进工程的 `events`，`video_read` 把模型上次读取以来的事件一起交给它。右栏「剪辑」tab 按会话 preset 自隐：只在组合含 `@khorsheed/dsh-video-studio/tool` 行的会话出现，读不到判据时 fail-open。

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
