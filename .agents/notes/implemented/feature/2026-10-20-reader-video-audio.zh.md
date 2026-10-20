# Agent Note: 灵感空间里的视频与音频

Status: implemented

## Problem

灵感空间只会读文章。视频（YouTube、B 站）和音频（播客订阅源、小宇宙）要么被当成网页去抓——把视频页「抽取」成一堆垃圾——要么根本进不来；灵感空间的阅读工具（笔记、带着讨论、考考我、同步画布、模型的 `reader_read`）对它们全都用不上。本文是 `proposals/active/2026-10-20-reader-video-audio.md` 的 V1：平台字幕、播放器、带时间的笔记；本机转写是 V2（`2026-10-20-transcribe-engine.md`）。

## Decision

- **转写稿就是正文。** 字幕解析（YouTube json3 / 滚动 VTT、SRT、B 站 JSON——`src/captions.ts`）后合并成段（有标点：满 15 秒遇句末、2.5 秒停顿或 60 秒断段；无标点——YouTube 自动字幕完全没有标点——满 15 秒遇 0.7 秒停顿或 35 秒断段），渲染成 `<p data-t="秒">`。笔记、高亮、翻译、¶ 快照、`reader_read` 不用改就能用；快照每段前加 `[mm:ss]`。
- **类型按每一条判断，不按来源。** `media.ts` 依据订阅源附件（RSS `<enclosure>`、Atom `link rel=enclosure`，带 iTunes 时长与封面）、可识别的链接（YouTube / B 站视频、小宇宙单集）或链接源的合成页面判断。有正文的网页即使嵌了视频也仍是文章。
- **媒体链接变成灵感空间本来就懂的来源。** 单个视频或单集存成 `link` 源，载荷是合成页面（`media-host.ts`），带 `<meta name="dsh-reader:media">`；YouTube 频道和小宇宙节目页每次抓取时就地转成 RSS。下游没有任何地方需要认识新的来源类型。
- **yt-dlp 由插件自己管理。** 2026-10-20 实测：机器上 2023 年的 yt-dlp、以及 pip 在 Python 3.9 上还能装的 2025 版都读不了 YouTube（字幕要新抽取器、不需 PO token 的客户端和 JavaScript 运行时）。灵感空间在 `<state>/bin/` 下自留一份官方独立版（用 curl 下载——它遵循部署的代理环境变量，Node 的 fetch 不遵循——两周后 `-U` 自更新），把 Node 交给它当 JS 运行时，只用 `--skip-download` 取元信息、字幕和平铺列表。`ytdlpPath` 可覆盖。
- **打开时取字幕并保留。** 打开视频先读已存的转写稿，没有就由 `mediaTranscript` 取原语言字幕（先上传的，再 `-orig` 自动字幕——机翻的自动字幕正是触发 YouTube 429 的那类），存成不过期的正文；没字幕的视频记进 `media.json`。音频在 V2 之前显示简介。文章那几条路径（抓取、自动补抓、保存订阅源正文）对媒体条目一律不走，宿主端的自动补抓也跳过媒体网址。
- **播放器。** YouTube 嵌入放在插件自建的播放框里（`allow-scripts allow-same-origin allow-presentation`、strict-origin 来源策略——正文的严格沙箱会让它失效），经 postMessage 控制：`seekTo` / `playVideo`，`infoDelivery` 每秒约四次报告当前时间（实测），据此标出正在播的段（`data-now`）并跟随；手动滚动暂停跟随 6 秒。B 站外链播放器没有控制通道、什么都不报告（实测），跳转就带 `t` 重新加载，也没有跟随。音频用原生元素。播放位置按条目记在 `localStorage`；「字幕」开关（按条目）收起转写稿。
- **不含文字的时间标记。** 每段前一个 `<button data-reader-ts data-label>`，标签用 CSS `content: attr(data-label)` 画出——选区（因此笔记摘抄）永远不含时间，`translate.ts` 也跳过它（`data-reader-no-translate`）。
- **笔记带上时间。** `ReaderNoteAnchor.time` 是所在段的开始；笔记上的 ▶ 从那里播；带着讨论的草稿和 `reader_read` 显示 `[mm:ss]`。

## Alternatives considered

**YouTube 自家的频道 RSS（`feeds/videos.xml?channel_id=`）。** 频道页仍在声明它，但它返回 404（三次实测）；改用 yt-dlp 平铺列表加 `youtubetab:approximate_date`。

**订阅 B 站 UP 主。** 不登录时空间列表被拒（`352`），多数字幕也一样；等值得加 cookie 设置时再做。

**把视频或音频下载到本地播放。** 不采用：平台播放器就能播，除了字幕与元信息什么都不取；只有 V2 的转写会临时下载音频，用完即删。

**每个平台一种来源类型。** 不采用：合成页面和合成 RSS 让现有路径（刷新、去重、最近阅读、笔记）原样工作。

## Consequences

- 有字幕的视频能像文章一样读、搜、记笔记、讨论；没字幕的视频（以及所有音频）等 V2。
- 灵感空间状态根下多一个程序（约 35 MB）和两项状态（`media.json`、`bin/`）；一台机器第一次取字幕时要先下载它。
- B 站视频跳转靠重新加载播放器，没有跟随；不支持订阅 UP 主。
- 无标点的自动字幕约 30 秒一段，可能把一句话切开。
