# @khorsheed/dsh-transcribe

[English](README.en.md) | 中文

在这台电脑上把长录音转成**带时间戳、可分说话人**的文字。它是一个宿主侧服务 `transcribe`，给其它插件在代码里调用——剪辑插件的「分人与转写」、灵感空间里没有字幕的视频和播客都用它。自己没有面板，也没有模型可见的工具。

## 特性

- **中英文**——中文走 Paraformer + CT-Transformer 标点（逐字时间更准）；英文与自动判断语种走 SenseVoice（自带标点与大小写，能判出 zh / en / ja / ko / yue）。两者都给逐字（词片）时间戳。
- **可选分说话人**——pyannote 分段 + CAM++ 声纹聚类，再按声纹合并过度切分的说话人；可传入已知声纹做「认人」。
- **边转边出**——任务按段推进，每转完一段就通过 `onSegments` 交给调用方，长录音不用等到最后。
- **一次一个、排队、可取消**——所有使用方共用一条队列；中止 `AbortSignal` 会把排队中的任务撤下、把正在跑的停掉。识别在独立子进程里跑，不占宿主事件循环。
- **模型首次使用时下载**——Hugging Face 或 HF-Mirror 国内镜像（默认自动探测最快可达源），断点续传，按钉死的字节数与 sha256 校验。只下载这次任务要用的模型。
- **不存转写结果**——解码出的临时 WAV 任务结束即删；文字交给调用方自己保存。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-transcribe
```

包声明了 `dsh.bundle`，add 会把它的 `cordis.patch.yml` 行（loader 行 id `transcribe`）并入 profile。需要本机有 `ffmpeg`（PATH 上，或在插件配置 `ffmpegPath` 里填路径）。

```sh
dsh plugin --profile web remove @khorsheed/dsh-transcribe
```

## 服务 API

```ts
const transcribe = ctx.get('transcribe')   // 没装时是 undefined：调用方提示并降级

const ids = transcribe.modelsFor({ language: 'en' })     // 这次要哪些模型
await transcribe.missingBytes(ids)                         // 还要下载多少字节（0 = 就绪）

const result = await transcribe.run(
  {
    input: { files: ['/path/episode.m4a'] },   // 或 { wav } —— 已是 16 kHz 单声道 16 位
    language: 'auto',                          // 'zh'（默认）| 'en' | 'auto'
    diarize: false,                            // 或 { voices, matchThreshold, numSpeakers }
    owner: '@khorsheed/dsh-reader',
    label: '某期节目',
  },
  {
    signal,                                    // 撤下 / 停止
    onProgress: (p) => {},                     // { stage, progress: 0–1, ahead? }
    onSegments: (segments) => {},              // 刚转完的段
  },
)
// result.segments: [{ cluster, start, end, text, tokens: [{ text, start, end }] }]
// result.speakers: 分说话人时每个聚类一条（时长、声纹、认出的已知声纹）
// result.language: SenseVoice 判出的主要语种
```

| 方法 | 作用 |
|---|---|
| `modelsFor(request)` | 一个请求需要的模型 id |
| `models()` | 全部模型的安装状态（从磁盘重读） |
| `missingBytes(ids)` | 这些模型还差多少字节 |
| `prepare(ids, source?)` | 下载缺的模型；结束后用 `models()` 看有没有失败 |
| `run(request, options?)` | 排队执行，返回结果；缺模型时先下载 |
| `queue()` | 当前队列（正在跑的在前） |

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `stateDir` | `$DSH_HOME/state/transcribe` | 模型与临时文件的位置 |
| `ffmpegPath` | 自动查找 | 指定 ffmpeg |
| `modelSource` | `auto` | `auto` / `huggingface` / `hf-mirror` |
| `numThreads` | `4` | 每个识别器的线程数 |

## 模型

| 模型 | 用途 | 大小 |
|---|---|---|
| Paraformer 中文（int8） | 中文转写 | 243 MB |
| CT-Transformer（int8） | 中文标点 | 80 MB |
| SenseVoice 2024-07-17（int8） | 英文与自动语种 | 240 MB |
| pyannote segmentation 3.0 | 分说话人 | 6 MB |
| CAM++ | 声纹 | 28 MB |

模型放在 `$DSH_HOME/state/transcribe/models/`。以前剪辑插件下载到 `$DSH_HOME/state/video-studio/models/` 的模型，第一次用到时会挪过来，不用重新下载。

## Compatibility

- **宿主**：`>=0.1.5-rc.1`，在 0.2.1-rc.1 上验证。只提供宿主服务，没有浏览器端和模型工具，装在 profile 根上。
- **原生依赖**：`sherpa-onnx-node` 按平台带预编译原生插件（darwin-arm64 约 34 MB）。识别在独立子进程里跑，原生插件加载失败只让那次任务失败，不影响启动。
- **ffmpeg**：找不到时，需要解码的任务报错，不影响启动；直接给 WAV 的任务照常。
- **使用方探测**：剪辑插件、灵感空间在每次需要转写时 `ctx.get('transcribe')`，没装时各自提示并降级，不会因它缺席而启动失败。
