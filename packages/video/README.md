# @khorsheed/dsh-video-suite

[English](README.en.md) | 中文

在 dsh 里剪播客和对谈：一条混录自动分出每个人，文稿就是剪辑台，删一句话就是删一段音频。

以前剪一期朋友间的对谈，要在剪辑软件里对着波形找每个人说的话，一刀一刀删语气词和长停顿。装上剪辑套件、把会话切到「剪辑模式」，导入录音后自动分出几个声音，用节目里存的声纹认出常驻成员；文稿按说话人分段着色，点一句剪掉、再点恢复。剪什么在会话里和 agent 商量——语气词、长停顿、说重复的由它扫描出来，作为一组提议等你 ✓，结构上的取舍也一样，你点头才落地；细节在右栏「剪辑」面板里调。最后导出播客音频、带字幕的完整视频、SRT 字幕、文稿和 shownotes。活多的时候，还能把一部分交给本机的 Codex / Claude Code / Kimi，或开一个协作间让几个 agent 一起做。这个套件写给做播客、录对谈的人。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-video-hero.png" width="640" alt="剪辑模式的会话：左边对话里是 agent 给出的一组剪辑提议，右栏剪辑面板显示按说话人着色的文稿与播放器">

## 可以这样跟 agent 说

- 「导入这期录音，分出几个人，认一下是不是常驻的两位主持。」
- 「把语气词和说重复的地方找出来，给我一组提议。」
- 「开头十分钟太散了，你建议怎么剪？」
- 「导出 MP3 和带字幕的 MP4，再写一份 shownotes。」

## 特性

- **一条混录也能认人**——本机说话人分离找出几个声音，再用节目里存的声纹认出常驻成员。
- **删字就是删音频**——文稿按说话人分段着色，点一句剪掉、再点恢复；默认只显示留下的内容，误剪有 6 秒撤销。
- **提议，不擅改**——agent 扫出的语气词、停顿、重复和结构取舍都是一组虚线提议，你 ✓ 才生效。
- **停顿缩短而不删**——长停顿默认缩到 0.6 秒，阈值可以按人设。
- **边听边剪**——播放器按剪后成片或原声播放，当前段落和词跟随高亮。
- **画面自动对齐**——手机拍的画面按声音波形和录音对齐，不需要拍手。
- **节目 → 工程**——节目存片头片尾、响度目标、字幕样式、剪辑习惯和声纹，每期工程沿用。
- **导出**——MP3、1080p MP4（字幕烧录或可开关字幕轨）、SRT、TXT，在后台跑，进度在面板和会话里都看得到。
- **多一双手**——把活委派给本机的 Kimi / Codex / Claude Code，或开协作间让几个 agent 一起做。
- **只在剪辑模式的会话里出现**——剪辑、委派与协作间的模型工具按会话授予，其它会话一个也看不到。

## 成员

| 成员 | 它做什么 |
| --- | --- |
| 剪辑台（`@khorsheed/dsh-video-studio`） | 节目与工程、媒体任务，右栏「剪辑」面板 |
| 本机转写（`@khorsheed/dsh-transcribe`） | 剪辑台的分人与转写引擎（2026-10-20 从剪辑台抽出） |
| 本地 Agent 核（`@khorsheed/dsh-local-agent`） | 本地 CLI 智能体家族核心：每家 CLI 一份隔离目录、登录命令与设置卡片 |
| Kimi（`@khorsheed/dsh-local-agent-kimi`） | 把任务委派给本机的 Kimi Code CLI |
| Codex（`@khorsheed/dsh-local-agent-codex`） | 把任务委派给本机的 Codex CLI |
| Claude Code（`@khorsheed/dsh-local-agent-claude-code`） | 把任务委派给本机的 Claude Code |
| dsh 委派（`@khorsheed/dsh-local-agent-dsh`） | 把任务委派给一个隔离的无头 dsh（设置里打开，默认关） |
| 协作间（`@khorsheed/dsh-room`） | 把会话升级为有协调者和成员的协作空间，成员取自本地 agent 与 dsh 原生子成员 |

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-video-suite`（或从市场索引里选它），确认后重启实例——装这一个，成员随依赖一起到达，模式与成员由本包统一挂载。随后在会话的模式选择器里切到「剪辑模式」。

命令行等价：

```sh
dsh plugin --profile web add @khorsheed/dsh-video-suite
```

<!-- collection:start -->
推荐连同基础体验一起装(「剪辑」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-video-suite
```
<!-- collection:end -->

```sh
dsh plugin --profile web remove @khorsheed/dsh-video-suite
```

卸载即整族移除（含剪辑模式）；想保留成员、只关某一个，用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.7-rc.1`）：✅ 完整——纯组合；成员地板 `0.1.5-rc.1`（video-studio），但模式 preset 行（`@deepseek-ai/dsh-agent-preset` 声明行）在 `0.1.7-rc.1` 才存在，故地板取两者较高者。成员行为细节见其自己的 Compatibility 节。
- 源码线（deepseek-harness master）：✅ 完整（verifiedHost: 0.2.1-rc.1）。

**版本线对照**：`0.1.0` 起要求宿主 `0.1.7-rc.1` 及以后。

## 已知限制

- **要本机的 ffmpeg**——剪辑与导出需要 `ffmpeg` / `ffprobe`；语音模型（约 360 MB）在第一次转写时自动下载。
- **混录不能只剪一个人**——剪一段就是这段时间所有人一起剪，抢话、附和默认保留；每人一支麦的多轨录音还没做。
- **素材按路径导入**——在面板里填本机路径或在会话里给路径，浏览器拖入上传还没做。
- **分人准确率取决于录音**——离录音笔远、声音相近、抢话多的录音会分错，需要在面板里合并或改段。
- **CLI 本体要自己装**——委派用的各家 CLI 需在 `PATH` 上自行安装并登录；本包不代装、不代登录。
- **卸载是整族的**——remove 本包会把成员一起移除；想只关某一个，用 bundle 详情页的行级开关。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**模式包 = 家族整合包 + 一行模式 preset。** 本包不注册任何服务、工具、槽位或命令。`cordis.patch.yml` 的成员行逐字来自成员包自己的 `cordis.patch.yml`；末尾一行 `preset-dsh-video`（`@deepseek-ai/dsh-agent-preset` 声明，模式 id `dsh-video`）是本包自有的正本——它曾镜像自 `@khorsheed/dsh-presets`，该包已于 2026-10-24 退役。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死整个形状：行只允许落在「成员规范行全集 + 恰好一行 preset-<mode>」内，成员必须是真实自挂载包，每个成员至少贡献一行，mode 值全树唯一。

| 成员包 | 行 id |
| --- | --- |
| `@khorsheed/dsh-video-studio` | `video-studio`；`video-studio-tool`（由本包 preset 授予） |
| `@khorsheed/dsh-transcribe` | `transcribe` |
| `@khorsheed/dsh-local-agent` | `local-agent` |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi`；`tool-subagent-kimi`（由本包 preset 授予） |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex`（+ override `tool-subagent-codex`）；`tool-subagent-codex-local`（由本包 preset 授予） |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code`（+ override `tool-subagent-claude-code`）；`tool-subagent-claude-code-local`（由本包 preset 授予） |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` |
| `@khorsheed/dsh-room` | `room`；`room-tool`（由本包 preset 授予） |

**模型工具按会话授予。** 剪辑模式 = 剪辑搭档人格加剪辑工作流：`video_*` 工具与 `video-studio` 技能是 video-studio 包的 `./tool` 组合入口，由本包 preset 行的 `video-studio-tool` 授予点按会话授予，不是 profile 根行；委派工具 `subagent_kimi` / `subagent_codex` / `subagent_claude_code` 与协作间的 `room-tool` 同理。两条 bare override 停用官方 preset 里与本家族同名的工具行（`subagent_codex` / `subagent_claude_code`），逐字取自 codex / claude-code provider 自己的 patch。

**无卡库。** `@khorsheed/dsh-local-agent-dsh-headless` 进 `dependencies` 不进 patch 行，清单页不出现，随家族存亡。

**装我 = 装成员 + 一个模式，不双挂。** 成员列进 `dependencies`（安装即带齐），同时登记进 `dsh.references`（家族名册供 pack 期与目录层读取）。`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层（`reconcilePlugins`）——装本 bundle 只应用**本** patch，成员自己的 patch 不被应用，任何一行都不会挂两次。成员单独安装仍自挂载；重叠由 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**（`MODE` / `FAMILY_MEMBERS`），让包有可构建的 `lib/`（pack-dist 的硬性要求）。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/video`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
