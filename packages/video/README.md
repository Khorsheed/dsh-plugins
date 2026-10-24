# @khorsheed/dsh-video-suite

[English](README.en.md) | 中文

剪辑模式一个包装齐:`dsh-video` agent preset 连同剪辑台——播客与对谈剪辑,一条混录自动分人、节目声纹认人、删字即删音频。清单里只多一张「剪辑模式」卡片;切到剪辑模式的会话自动拿到 `video_*` 工具与剪辑技能。

## 这是什么模式

剪辑模式 = 剪辑搭档人格加剪辑工作流:会话里商量剪什么(每刀都是提案,你点头才落地),右栏「剪辑」面板看同一个项目、调细节,导出音频、视频、字幕和 shownotes。会话在模式选择器里切到「剪辑模式」即获得这些;其它会话一个也看不到。

## 成员

| 成员包 | 行 id | 能力 |
| --- | --- | --- |
| `@khorsheed/dsh-video-studio` | `video-studio` | 剪辑台:项目库与媒体任务的服务核心,右栏「剪辑」面板 |
| `@khorsheed/dsh-transcribe` | `transcribe` | 本机转写:剪辑台的分人与转写引擎(2026-10-20 从剪辑台抽出) |

`video_*` 工具与 `video-studio` 技能不是 profile 根行:它们是 video-studio 包的 `./tool` 组合入口,由本包 preset 行的 `video-studio-tool` 授予点按会话授予。

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-video-suite`(或从市场索引里选它),确认后重启实例——装这一个,成员随依赖一起到达,模式 preset 与成员行由本包的 patch 统一挂载。随后在会话的模式选择器里切到「剪辑模式」。

命令行等价:

```sh
dsh plugin --profile web add @khorsheed/dsh-video-suite
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-video-suite
```

卸载即整族移除(含模式 preset);想保留成员、只关某一行,用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.7-rc.1`):✅ 完整——纯组合;成员地板 `0.1.5-rc.1`(video-studio),但模式 preset 行(`@deepseek-ai/dsh-agent-preset` 声明行)在 `0.1.7-rc.1` 才存在,故地板取两者较高者。成员行为细节见其自己的 Compatibility 节。
- 源码线(deepseek-harness master):✅ 完整(verifiedHost: 0.2.1-rc.1)。

**版本线对照**:`0.1.0` 起要求宿主 `0.1.7-rc.1` 及以后。

## 已知限制

- **卸载是整族的**——remove 本包会把成员一起移除;想只关某一行,用 bundle 详情页的行级开关。
- **preset 行的正本就在本包**——它曾镜像自 @khorsheed/dsh-presets,该包已于 2026-10-24 退役。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**模式包 = 家族整合包 + 一行模式 preset。** `cordis.patch.yml` 的成员行逐字来自成员包自己的 `cordis.patch.yml`;末尾一行 `preset-dsh-video`(`@deepseek-ai/dsh-agent-preset` 声明)是本包自有的正本(曾镜像自已退役的 `@khorsheed/dsh-presets`)。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死整个形状:行只允许落在「成员规范行全集 + 恰好一行 preset-<mode>」内,成员必须是真实自挂载包,每个成员至少贡献一行,mode 值全树唯一。

**装我 = 装成员 + 一个模式,不双挂。** 成员列进 `dependencies`(安装即带齐),同时登记进 `dsh.references`(家族名册供 pack 期与目录层读取)。`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层(`reconcilePlugins`)——装本 bundle 只应用**本** patch,成员自己的 patch 不被应用,任何一行都不会挂两次。成员单独安装仍自挂载;重叠由 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**(`MODE` / `FAMILY_MEMBERS`),让包有可构建的 `lib/`(pack-dist 的硬性要求)。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/video`)。问题与贡献请移步该仓库。
