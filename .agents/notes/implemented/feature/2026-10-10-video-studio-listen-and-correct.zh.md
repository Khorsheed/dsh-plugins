# Agent Note: 剪辑台——边听边剪的播放器、剪切来源区分、转写改字

Status: implemented

## Problem

M1 的文稿 tab（见 [video-studio proposal](../../proposed/feature/2026-10-06-video-studio-podcast-editing.md)）是个只看不动听的界面：点句剪掉、✓ 采纳提议，但要等导出才能听到成片。拿用户的真实 19 分钟录音验收时暴露出四个缺口：没法边剪边听；用户自己剪的和模型剪的（已采纳）看起来一模一样；文稿靠手动「再显示 N 段」翻页，播放跟随迟早会跑在未渲染的内容里；转写错字（坚顾实为坚固、门法实为门阀）没有修的路——这个 Paraformer 构建不接受自定义词表，只能在转写后修。

## Decision

**文稿就是试听器。** 文稿 tab 底部一条吸底播放条，两种方式放参考录音——剪后（保留区间无缝拼接，每个剪口 12 ms 淡入淡出）和原声（原样）——播放中可切换，进度条在成片时间与原始时间之间双向换算。音频由宿主从工程缓存的 16 kHz ASR WAV 里直接读原始 PCM（`videoStudio.audioChunk`，base64 PCM16，每次 ≤60 秒），浏览器端用 Web Audio 无缝调度（`src/client/player.ts`）。因此 **转写完成后不再删除该 WAV**——它留在工程缓存目录当播放器的音频代理，可随时由 ffmpeg 重建。正在播放的段落和词高亮（`data-playing` / `data-now`），视图滚动跟随（有「跟随」开关），翻页自动化：IntersectionObserver 哨兵替代手动「再显示」按钮，跟随模式会向前翻页，播放永远不会跑过渲染。

**剪切带来源。** 已采纳的剪切按 `edit.origin` 渲染：用户剪的单删除线，模型剪的紫色双删除线，配图例和过滤 chips（全部 / 待确认 / 我剪的 / 模型剪的）。悬停模型剪切能看到理由（语气词、长停顿、重复）。`scanTranscript` 只把 `cut`/`shorten` 计入已覆盖，改字不再压制重新扫描。

**改字是一等编辑类型。** `EditKind` 新增 `'text'`：落在词区间上，带 `text`（改后）和 `from`（原文）。`displayTokens()`（`src/core/text.ts`）把改后的区间换进显示文稿、SRT/ASS 字幕、TXT 导出和模型的 `video_read` 视图——音频与剪切时间一律不动。两条产生路径：面板——拖选几个字，选区上方弹出竖向菜单（▶ 从这里播放 / 剪掉 / 选区覆盖已剪时的恢复 / 改字…），「改字…」打开查找栏、以选中文字预填并把当前命中定位到该处，栏内「替换当前 / 全部替换」立即生效；以及模型——`video_propose_edit` 新增 `fix_text`（[{from, to}] → 每处命中合成一个提议组）和 `cut_keyword` 动作——模型的改字和剪切一样停在 `proposed`，等用户 ✓。（此处最初的横向气泡内联表单、「找同款」按钮、以及节目级 `Settings.replacements` 自动套用后来已重做或移除——见 [find-nav note](2026-10-18-video-studio-find-nav.md)。）

## Alternatives considered

- **`<audio>` 加代理文件或 HTTP range 流。** 放不了「剪后」：保留区间的无缝拼接要求采样级精确的调度和剪口淡入淡出，这正是 Web Audio 的模型；从缓存 ASR WAV 读 PCM 天然采样级对齐。
- **直接改写文稿 token。** 违背 proposal 的非破坏原则：一切都是落在原始录音时间上的编辑，所以改字也是一种编辑类型，可逆、可归因，原文留在 `from`。
- **给 ASR 喂自定义词表。** 这个 Paraformer 构建没有该输入；节目级替换规则对反复出现的人名术语达到同样效果，还顺带成为节目设置里可见、可删的记录。
- **保留手动翻页按钮。** 播放跟随让手动翻页变成 bug 温床；哨兵负责滚动加载，跟随效果负责在播放头之前加载。

## Consequences

- `project.json` 新增 `kind:'text'` 的编辑——增量（旧版本遇到未知 kind 忽略）。`SettingValue` 放宽出 `Record<string, string>`。（此处新增的 `Settings.replacements` 后被 [find-nav note](2026-10-18-video-studio-find-nav.md) 移除；`SettingValue` 保留放宽后的成员。）
- 每个工程保留它的 ASR WAV（每小时音频几十 MB），直到缓存清理；导出后 30 天的清理策略不变。
- 本变更之前导入的工程第一次播放时要多付一次 ffmpeg 解码来重建 WAV。
- 面板 remote 面新增四个动词（`fixText`、`replaceAll`、`cutMatches`、`audioChunk`）；`audioChunk` 单次最多回 60 秒 PCM。

## Testing

`tests/core.spec.ts` 覆盖 `displayTokens`（仅已采纳生效、按时间区间换词）和 `findOccurrences`（中文跨 token 匹配、大小写归一、改后文本可见、空串）。在 3197 临时实例上用真实的 19 分钟录音做了实机验收：两种模式持续 1× 播放、词级跟随高亮、滚动自动加载、来源过滤、查找（门阀 → 10 处）、全部替换并存进节目（坚顾→坚固，在 `shows/<id>.json` 里核实，文稿里标出 原文：坚顾；存进节目这条路径后被 [find-nav note](2026-10-18-video-studio-find-nav.md) 移除），以及工具链路端到端（`fix_text` → 提议组 → ✓ → SRT 字幕带改后文字）；同一轮里实测了选区气泡、找同款 → 查找栏接力，和改名后的过滤器。
