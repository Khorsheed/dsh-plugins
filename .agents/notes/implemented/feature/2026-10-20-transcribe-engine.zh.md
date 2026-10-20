# Agent Note：本机转写引擎做成公共插件

Status: implemented

## 问题

灵感空间要给没有字幕的视频和播客做本机语音识别（B 站字幕要登录，小宇宙没有字幕），而剪辑插件里已经有一条能用的 sherpa-onnx 管线，只是埋在它自己的包里。两份原生依赖、两套模型、两个吃 CPU 的任务队列会在同一台机器上互相抢。本条是 `proposals/active/2026-10-20-transcribe-engine.md` 的第 1 步。

## 决定

- **一个引擎 `@khorsheed/dsh-transcribe`，提供宿主服务 `transcribe`。** 工作进程（`speech-worker.ts`、`speech-worker-core.ts`、`speech-protocol.ts`、`speech.ts`）和模型管理（`models.ts`）用 `git mv` 搬过来；剪辑插件保留工程、剪辑、对齐、导出和面板。没有浏览器端，也没有模型工具。
- **使用方自己声明要调用的接口，包之间没有代码边。** 实测：`gen-typert` 只给带 `./typert` 的兄弟包解析类型，剪辑插件宿主文件里 type-only 导入 `@khorsheed/dsh-transcribe/types` 会让生成报 TS2307。所以剪辑插件声明一个结构化的小接口 `TranscribeEngine`（四个方法），每个任务用 `ctx.get('transcribe')` 探测，并在 `dsh.references` 里登记包名（提示文案里会提到它）。引擎不在时面板提示需要「本机转写」，分人与转写任务报这一句；剪辑和导出不受影响。
- **`run(request, options)` 内部排队。** 所有使用方共用一条队列，一次一个，按先后；中止会撤下排队中的任务或杀掉正在跑的子进程；`onSegments` 边转边交出完成的段；`onProgress` 给出整体 0–1 进度和阶段。引擎不存转写结果；临时解码的 WAV 任务结束即删。调用方也可以直接给一个 16 kHz 的 WAV（`{ wav }`）——剪辑插件就是这样，因为同一个文件还是它面板播放器的音频代理。
- **语言。** `zh` → Paraformer + CT-Transformer 标点（原来的路径，逐字时间）。`en` / `auto` → SenseVoice **2024-07-17** int8。2026-10-20 实测较新的 2025-09-09 int8 版：英文输出全大写、没有标点、语种标成 `yue`；2024-07-17 版大小写和标点正常、`en`/`zh` 判断正确，而且两版都给逐字时间戳（提案里的待验证项），所以直接用 SenseVoice 自己的 token。
- **分说话人可选。** 不分时整段录音是一个回合，在最安静处切成 ≤ 25 秒的块，每块作为一段（cluster 0）推出去；分的时候走原来的 分段 → 合并 → 归并 → 逐回合识别 → 声纹 路径，每个回合推一次。
- **只下要用的模型。** `modelsFor(language, diarize)`；`ModelManager.ensure(source, ids)` 改为串接下载轮次，而不是并入一轮不相干的下载。模型 id `asr` 改名 `paraformer`。
- **模型挪过来，不重下。** 第一次用到时，引擎把 `$DSH_HOME/state/video-studio/models/` 里已有的东西重命名到 `$DSH_HOME/state/transcribe/models/`（同一块盘），再删掉空的旧目录。
- **英文单词保留空格。** Paraformer 把英文拼成没有分隔的 BPE 片段（`lar@@ ge lan@@ gu@@ age`）；现在开始一个拉丁单词的片段前面加空格，`attachPunctuation` 在两边都跳过空白来对齐。

## 考虑过的其它做法

**注册进官方 `speechToText` 注册表。** 不采用（提案 D4）：只收短句、没有时间戳、没有长任务。

**type-only 依赖边（room → local-agent 那种）。** 暂不采用：要么给引擎加 `./typert` 面，要么改公共生成器，只为四个方法签名不值得。

**引擎也用 yt-dlp 去抓页面 URL。** 推迟：灵感空间本来就管着 yt-dlp、自己下载音频，所以引擎的输入保持为本地文件。

## 后果

- 只装剪辑插件、不装引擎时转写不可用（面板会说明）；`deploy:3080` 要两个一起上。
- 旧版剪辑插件还在跑的 3080，如果新引擎先在同一个 `$DSH_HOME` 上运行，会把它的模型目录挪走——两者一起部署就没有影响。
- `sherpa-onnx-node` 现在只是引擎的依赖。
