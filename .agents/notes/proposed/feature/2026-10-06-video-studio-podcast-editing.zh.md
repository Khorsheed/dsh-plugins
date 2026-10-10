# Agent Note: 剪辑台——以文稿为主的播客与对谈剪辑

Status: proposed

## Problem

用户和朋友们会录日常聊天、播客和对谈，想在 dsh 里剪：会话区讨论怎么剪，右栏面板调细节，最后导出一期节目。他们的录法决定了整个设计：

- **一条混录**：一群人围着一台录音笔或手机，所有人在同一个音频文件里，所以剪辑器要自己分出谁在说话。另一台设备经常同时拍桌面画面。
- **素材长、以说话为主**：原始约 70 分钟，成片约 50 分钟。大部分工作是去语气词、长停顿、说重复的和跑题的段落，逐帧精修很少。
- **固定节目**：同一拨人每周录，片头音乐、响度目标、字幕样式都一样，偶尔来一位嘉宾。
- **音频和视频同等重要**：每期出播客音频和完整视频，以后还有竖屏切片。

本仓目前没有任何处理音视频的包。2026-10-06 和用户把交互稿走了六轮，交互稿在本地不入库的 `proposals/prototypes/video-studio-podcast.html`。本文记录这几轮定下的决定和第一个实施切片。

## Proposal

### 形态：一个包加一行 preset

- **新包 `@khorsheed/dsh-video-studio`**（`packages/video-studio`），有三个面：
  - **宿主半**：部署级工程存储、媒体工具链（ffmpeg、语音模型）和后台任务队列。浏览器面板都经 Typert Remote（`videoStudio.*`）访问。
  - **`./tool` 子入口**：模型工具和 `video-studio` 技能。沿用 worktrees、room 折回核心包的伴生写法，不另开 `*-tool` 包。
  - **浏览器半**：一个页型右栏 tab「剪辑」，基于 `@khorsheed/dsh-client-ui-panel-kit`。
- **在 `@khorsheed/dsh-presets` 里新增 preset 行 `dsh-video`（剪辑模式）**：授权 `./tool` 行，携带剪辑指引。面板是部署级工作区（同画布空间），不做会话 preset 自隐藏，它的模式可见性就是安装层（docs/plugin-visibility.md）。

### 名词

- **节目**：一个固定系列，持有节目设置：片头、片尾和垫乐，响度目标，字幕样式，shownotes 格式，剪辑习惯（停顿处理、语气词表、每人停顿阈值），以及**声纹列表**。「不属于节目」也是合法选项，此时用全局默认。
- **工程**：一期节目。新建时**复制**一份所属节目的设置，之后改节目只影响以后新建的工程。工程是部署级的，不绑会话：一个会话一次打开一个工程，同一个工程可以跨多个会话剪。
- **设置三层**：全局 → 节目 → 这期，后面的层优先。面板的「设置」tab 显示每一项实际生效的值和来源（沿用节目 / 这期改过 / 全局）。这期改过的项可以存为节目默认，也可以恢复为节目默认。
- **素材库**：全局的配乐和音效文件夹，所有节目共用。节目设置按文件名引用其中的文件。

### 编辑模型：剪切都落在参考录音自己的时间上

工程唯一的正本是 `project.json`。所有编辑都是**参考录音时间轴**上的区间，所以编辑不破坏原文件，导出之前不重新编码任何东西。

```ts
interface Project {
  id: string; showId: string | null; name: string; createdAt: string;
  settings: Settings;                        // 建工程时的快照
  overrides: (keyof Settings)[];             // 这期改过的键
  sources: Source[];                         // 录音、画面、配乐；只记路径，文件留在原处
  speakers: Speaker[];                       // origin: {kind:'diarization'} | {kind:'track', sourceId}（多轨口子）
  transcript: Segment[];                     // {id, speakerId, start, end, tokens:[{text, start, end, kind:'word'|'filler'}]}
  edits: Edit[];                             // {id, kind:'cut'|'shorten'|'gain', start, end, value?, origin:'user'|'agent', state:'proposed'|'applied'|'rejected', group}
  chapters: Chapter[];                       // M2
  events: PanelEvent[];                      // 面板侧的改动，模型下一轮读取
}
```

- **成片时间**等于参考时间轴减去所有已生效的剪切和缩短。所有导出和时间戳（shownotes、SRT）都由程序推出来，不靠模型心算。
- **长停顿**是一条缩到 0.6 秒的 `shorten` 编辑（用户决定），不是剪切。
- **提议就是状态为 `proposed` 的编辑**，每条属于一个 `group`（一个 ✓/✗ 单位）。面板把它们画成紫色虚线。采纳或拒绝一个 group 是一次调用，可以撤回。
- **面板上的改动写进 `events`**。工具把模型上次读取以来的事件一并交给它，模型就不会覆盖用户手动改过的地方。
- **混录没法只去掉一个人的声音**：剪切会把这段时间所有人一起剪掉。分开重叠说话要人声分离模型，放到 M3。`speakers[].origin` 是给将来多轨输入（每人一条轨，按轨道认人）留的口子，计划中但不实现。

### 媒体流水线

| 步骤 | 做法 | 说明 |
|---|---|---|
| 探测 | `ffprobe` | 时长、流、采样率 |
| 画面对齐录音 | ffmpeg 把两边都解成单声道 8 kHz，在 JS 里对前 3 分钟做互相关 | 不需要拍手 |
| 代理与波形 | ffmpeg 生成单声道 16 kHz WAV（识别输入）、低码率预览、JSON 波形峰值 | 放在工程目录下，导出 30 天后清理 |
| 分人 | `sherpa-onnx-node` 离线说话人分离（pyannote 分段 + 3D-Speaker CAM++ 声纹） | 预编译原生插件，不需要 Python |
| 声纹匹配 | 同一个 CAM++ 提取器，和节目里存的声纹做余弦比对 | 新声音交给用户起名 |
| 转写 | `sherpa-onnx-node` 离线 Paraformer（中文 int8），逐个分人片段跑 | 即 FunASR 的 Paraformer 权重的 ONNX 版 |
| 语气词、停顿、重复扫描 | 在 token 和间隙上跑规则：设置里的语气词表、每人停顿阈值、相邻重复 n-gram | 产出一个提议组 |
| 响度 | ffmpeg `loudnorm`，两遍 | 播客 −16 LUFS，视频 −14 |
| 降噪 | 轻/中：ffmpeg `afftdn`；强：DeepFilterNet3 的 `deep-filter` 程序（模型 8.5 MB） | M2。用 `afftdn` 是因为 `arnndn` 要 ffmpeg ≥ 4.3 |
| 导出 | 按保留区间生成 ffmpeg 滤镜图（`atrim`/`trim` + `concat`），字幕用生成的 ASS 文件经 `subtitles=` 烧录；没有 libass 的 ffmpeg 改为可开关的 mov_text 字幕轨 | MP3（带 ID3 章节）、MP4、SRT、TXT |

**模型在第一次使用时下载**到 `$DSH_HOME/state/video-studio/models/`，来源是钉死版本的 sherpa-onnx GitHub release 资源，带 sha256 校验：Paraformer 中文 int8（2023-09-14 导出版，压缩包约 234 MB）、CT-Transformer 标点 int8 约 65 MB（Paraformer 自己不出标点）、pyannote 分段约 7 MB、CAM++ 约 28 MB；GitHub 不发布校验和，完整性靠压缩包的精确字节数和解压后必须存在的文件。全局设置里逐个列出大小和状态。离线或还没下载完时，只是转写不可用，面板其余部分照常工作。

**ffmpeg 靠查找，不打包。** 宿主在 PATH 上或全局设置指定的路径找 `ffmpeg` 和 `ffprobe`。缺任何一个，导入和导出就显示设计好的「请安装 ffmpeg」状态，插件照常启动。

**任务**：探测、代理、分人、转写、导出都作为宿主任务运行。重任务一次跑一个，持久化在工程里，重启后重新排队。面板轮询 `videoStudio.jobs` 拿进度。任务按输入哈希保证幂等。

### 存储

```
$DSH_HOME/state/video-studio/
  shows/<showId>.json                 # 设置 + 声纹索引
  voiceprints/<showId>/<id>.f32       # CAM++ 声纹，只存本机
  projects/<projectId>/project.json
  projects/<projectId>/cache/         # 代理、波形、识别用 wav（可丢弃）
  models/                             # 下载的 ONNX 模型
  settings.json                       # 全局层：素材库目录、导出目录、ffmpeg 路径、转写引擎
```

声纹不离开本机（用户决定）。素材库和默认导出目录是用户自己的文件夹，默认分别是 `~/Podcast/素材库/` 和 `~/Podcast/<节目>/<期号>/`。

### 模型工具（`./tool` 入口，用 `setToolOrigin` 打来源标记）

| 工具 | 作用 |
|---|---|
| `video_project` | 列出节目和工程；新建工程（按节目模板）；为当前会话打开一个工程 |
| `video_import` | 按宿主路径添加素材；启动探测、对齐、代理和分人/转写任务 |
| `video_read` | 读工程：素材、说话人、一段文稿、编辑、上次读取以来的事件、成片时长 |
| `video_scan` | 按当前阈值跑语气词、停顿、重复扫描，返回一个提议组 |
| `video_propose_edit` | 把剪切、缩短、音量调整，或说话人改名、合并，作为一组提议 |
| `video_render` | 排队导出（音频、视频、字幕和文稿），并报告进度 |

会话和工程的绑定存在宿主存储里，以会话 id 为键。工具读这个绑定；面板打开时跟随当前会话的工程。

### 面板（M1 的 tab）

素材（素材、说话人命名并可 ▶ 听样本、声纹匹配、任务列表）· 文稿（文稿粗剪：点一下剪掉或恢复，语气词和停顿标签，提议虚线框）· 导出 · 设置（三层、声纹列表带原地删除确认、模型列表）。没有打开工程时，首屏是按节目分组的工程列表，带「＋ 新建工程」。一套布局按宽度自适应，`@container dsh-panel (max-width: 560px)` 下为紧凑样式；`browserOnHost()` 为假时隐藏「在访达中打开」。

### 分期

1. **M1（本文的第一次实施）**：包骨架和 preset 行；节目、工程和设置三层；按路径导入；画面对齐；代理；分人、声纹和转写；文稿粗剪和扫描提议；导出 MP3（loudnorm）、带烧录字幕的 MP4，以及 SRT/TXT；M1 的工具和技能；面板 tab 素材/文稿/导出/设置。
2. **M2**：章节和结构提议；时间线 tab（按人展开的轨道、闪避音量线、把音频拖到轨道上）；声音 tab（afftdn 和 DeepFilterNet 降噪、每人逐段音量、A/B 预览）；浏览器拖入小体积素材库文件；百炼 Paraformer 云端引擎。
3. **M3**：竖屏切片、处理抢话的人声分离、多轨输入、多机位、FCPXML 导出。

## Alternatives considered

**Python 版 FunASR。** 模型相同、有参考流水线，但每台宿主都要一个带 torch 的受管 Python 环境，多出约 1 GB，还要再看管一个运行时。`sherpa-onnx-node` 用预编译的 Node 原生插件就能跑同样的 Paraformer 和 CAM++ 权重。

**whisper.cpp 或 Groq Whisper 作为默认引擎。** 两者都不分人，而混录离不开分人。Whisper 的中文标点和简繁输出也不如 Paraformer 稳定。

**只用云端转写。** 音频是朋友间的私人聊天；免费额度（百炼每月 10 小时）几期就用完了。云端留作 M2 的可选引擎。

**浏览器里跑 ffmpeg.wasm。** 对一小时的文件太慢、受内存限制，还会把工具链带到手机路径上。文件本来就在宿主上。

**以传统非线编时间线为主界面。** 播客剪辑主要是决定留哪些话，以文稿为主、在源时间上剪更合适；时间线（M2）是同一组编辑的另一种看法。

**工程绑定会话。** 一期节目会跨好几个会话剪，面板也要在没有会话时可用。部署级状态是画布的先例。

**面板和工具拆成两个包。** 本仓已经把伴生工具行折回核心包（worktrees 0.3.0、room 0.2.0）。用 `./tool` 子入口行就能保持一个包、一个名字、一个 id。

**打包 ffmpeg。** 每个平台多 80 MB，还有许可证问题。会剪媒体的宿主本来就装了 ffmpeg，缺了也能干净降级。

## Acceptance criteria

在临时实例上、再在 3080 上满足以下各条，M1 就算完成：

- 在剪辑模式里说「周五又录了一期，素材在 <目录>」，模型会提议按节目模板新建工程；采纳后导入文件、启动任务，面板打开到素材页。
- 一条 3～4 人、70 分钟的混录能被分人、和存好的声纹匹配（新声音标出来等命名）并转写完，进度可见。
- 文稿 tab 显示按说话人着色的段落。点一句就剪掉或恢复；扫描提议用虚线框出语气词、停顿和重复，✓ 作为一组生效，成片时长跟着更新。
- 面板上的改动会作为事件出现在模型下一次的 `video_read` 里。
- 导出得到 −16 LUFS ±1、带 ID3 章节（有章节时）的 MP3；切口和文稿一致、字幕烧录的 MP4；时间戳按成片时间算的 SRT。
- 设置 tab 显示三层和来源；「存为节目默认」「恢复为节目默认」可用；删除声纹会先在原地确认。
- 缺 ffmpeg 或模型还没下载时，插件照常启动，面板显示设计好的缺失状态。
- `pnpm check:plugins`、`pnpm check:panels --package packages/video-studio`、`pnpm --filter @khorsheed/dsh-video-studio test` 和 presets 的测试全部通过。

## Risks

- **插件里带原生插件。** `sherpa-onnx-node` 按平台发可选包（darwin-arm64 约 34 MB）。pack-dist 和 tarball 安装路径必须带上对应平台的包，否则就得懒加载并降级。M1 其余部分在它之上搭建之前，先在 3080 的 tarball 路径上验证这一点。
- **远场分人准确率。** 桌上一台录音笔，音量不均、有房间回声。M1 就做合并、拆分和逐句改说话人，因为出错是必然的。
- **宿主上的 ffmpeg 版本旧。** 本机是 4.2.2（anaconda），选用的滤镜必须在 4.2 里存在；最低版本检查会报告缺什么。
- **磁盘。** 代理和识别用 WAV 每期几百 MB。默认导出 30 天后清理，清理永远不碰素材原文件。
- **长任务跨重启。** 任务按输入哈希幂等。任务中途崩溃只会重跑，不会把工程写坏，因为 `project.json` 是原子写入。
- **暂时放弃的**：从重叠说话里去掉一个人的声音、多轨输入、云端转写。都推迟了，数据模型里都留了口子。
