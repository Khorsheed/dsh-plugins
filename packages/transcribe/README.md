# @khorsheed/dsh-transcribe

[English](README.en.md) | 中文

在这台电脑上把长录音转成带时间的文字，还能分出谁在说话。

你不用单独装它：装好写作、学习或剪辑套件，它就一起到了。剪辑里的「分人与转写」、灵感空间里给没字幕的视频和播客出文稿，用的都是它。下面是写给插件作者的。

## Compatibility

需要 DSH 0.1.5 或更新版本，已在 0.2.1 上验证。

## 给开发者

它只提供一个宿主服务 `transcribe`，没有侧栏，也没有给 agent 的工具。随时可能没装，用之前先探测，没有就提示并降级：

```ts
const transcribe = ctx.get('transcribe')        // 没装时是 undefined

const result = await transcribe.run(
  {
    input: { files: ['/path/episode.m4a'] },      // 或 { wav }：16 kHz 单声道 16 位
    language: 'auto',                             // 'zh'（默认）| 'en' | 'auto'
    diarize: false,                               // 或 { voices, matchThreshold, numSpeakers }
    fromSec: 0,                                   // 可选：从第几秒续跑，返回的仍是绝对时间
    owner: '@khorsheed/dsh-reader',
    label: '某期节目',
  },
  { signal, onProgress: (p) => {}, onSegments: (segments) => {} },
)
// result.segments: [{ cluster, start, end, text, tokens: [{ text, start, end }] }]
// result.speakers: 分说话人时每个声音一条（时长、声纹、认出的已知声纹）
// result.language: 判出的主要语种
```

| 方法 | 作用 |
|---|---|
| `run(request, options?)` | 排队执行并返回结果，缺模型时先下载；`onSegments` 每转完一段就回调一次 |
| `speakers(request, options?)` | 只分说话人、不转文字（已有文稿时用）；只有一个人时直接返回 |
| `modelsFor(request)` / `missingBytes(ids)` | 这次要哪些模型、还差多少字节（0 = 就绪） |
| `prepare(ids, source?)` / `models()` | 下载缺的模型 / 看各模型的安装状态 |
| `queue()` | 当前队列，正在跑的在前 |

- **一次只跑一个**：所有调用方共用一条队列；中止 `signal` 会撤下排队中的任务、停掉正在跑的。识别在独立子进程里跑，原生模块加载失败只让那次任务失败。
- **语种**：中文用 Paraformer + CT-Transformer 标点；英文和自动判断用 SenseVoice。分说话人用 pyannote + CAM++ 声纹，可传入已知声纹来认人。
- **模型**第一次用到时下载到 `$DSH_HOME/state/transcribe/models/`（只下这次要用的），来源可选 Hugging Face 或 HF-Mirror，断点续传、下载后校验；以前剪辑插件下载过的会挪过来。
- **不存结果**：临时音频任务结束即删，文字由调用方自己保存。需要本机有 `ffmpeg`，找不到时需要解码的任务报错，不影响启动。
- **配置**：`stateDir`、`ffmpegPath`、`modelSource`（`auto` / `huggingface` / `hf-mirror`）、`numThreads`（默认 4）。
- 单独安装：`dsh plugin --profile web add @khorsheed/dsh-transcribe`。隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
