# @khorsheed/dsh-learning

[English](README.en.md) | 中文

学习模式一个包装齐:`dsh-learning` agent preset 连同图书馆——按项目组织的精读学习(书籍摄入、路线图、知识卡片、测验判题)与精读教练。清单里只多一张「学习模式」卡片;切到学习模式的会话自动拿到图书馆工具与教练人格。

## 这是什么模式

学习模式 = 精读教练人格(和你一起读,而不是替你读)加图书馆的模型面:`library_read`、每个名词一个写工具、`library_assess` 判分;联网选材与版本核实走 web 工具,长会话有压缩,技能面是白名单,shell 有看守。会话在模式选择器里切到「学习模式」即获得这些;其它会话一个也看不到。

## 成员

| 成员包 | 行 id | 能力 |
| --- | --- | --- |
| `@khorsheed/dsh-library` | `library` | 图书馆:按项目组织的精读学习——书籍摄入、路线图、词书与测验判题(服务核心与学习侧栏) |
| `@khorsheed/dsh-canvas` | `canvas`、`canvas-agent`(由本包 preset 授予) | 灵感画布:读完用自己的话写成卡片与成稿,以输出促吸收(2026-10-19 加入) |
| `@khorsheed/dsh-reader` | `reader`、`reader-tool`(由本包 preset 授予) | 灵感空间:订阅与文章阅读、记笔记、带着笔记讨论、「让Agent考考我」(2026-10-19 加入) |
| `@khorsheed/dsh-transcribe` | `transcribe` | 本机转写:灵感空间里没有字幕的视频、播客在本机转成文字(2026-10-20 加入) |
| `@khorsheed/dsh-capture` | `capture` | 渲染抓取:用后台 Chrome 渲染依赖脚本的页面,供灵感空间抽取正文(2026-10-20 从基础合集移来) |

图书馆的模型面(工具、教练指引段、library 技能)不是 profile 根行:它是 library 包的 `./tool` 组合入口,由本包 preset 行的 `library-tool` 授予点按会话授予。画布的 `./agent` 与灵感空间的 `./tool` 同样由 `canvas-agent`、`reader-tool` 授予点按会话授予,两个右栏页签都按这两行自隐——只在学习模式与写作模式的会话里出现。

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-learning`(或从市场索引里选它),确认后重启实例——装这一个,成员随依赖一起到达,模式 preset 与成员行由本包的 patch 统一挂载。随后在会话的模式选择器里切到「学习模式」。

命令行等价:

```sh
dsh plugin --profile web add @khorsheed/dsh-learning
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-learning
```

卸载即整族移除(含模式 preset);想保留成员、只关某一行,用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.7-rc.1`):✅ 完整——纯组合,地板即成员自身(minHost `0.1.7-rc.1`,library 的地板;preset 行机制同线)。成员行为细节见其自己的 Compatibility 节。
- 源码线(deepseek-harness master):✅ 完整(verifiedHost: 0.2.1-rc.1)。

**版本线对照**:`0.1.0` 起要求宿主 `0.1.7-rc.1` 及以后。

## 已知限制

- **卸载是整族的**——remove 本包会把成员一起移除;想只关某一行,用 bundle 详情页的行级开关。
- **preset 行镜像自 @khorsheed/dsh-presets**——两处内容逐字一致,由仓级 parity spec 钉住;presets 包退役后此处为正本。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**模式包 = 家族整合包 + 一行模式 preset。** `cordis.patch.yml` 的成员行逐字来自成员包自己的 `cordis.patch.yml`;末尾一行 `preset-dsh-learning`(`@deepseek-ai/dsh-agent-preset` 声明)逐字镜像自 `@khorsheed/dsh-presets`,由 `scripts/preset-mode-parity.spec.ts` 钉住两边 plugins 组合与展示字段不漂移。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死整个形状:行只允许落在「成员规范行全集 + 恰好一行 preset-<mode>」内,成员必须是真实自挂载包,每个成员至少贡献一行,mode 值全树唯一。

**装我 = 装成员 + 一个模式,不双挂。** 成员列进 `dependencies`(安装即带齐),同时登记进 `dsh.references`(家族名册供 pack 期与目录层读取)。`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层(`reconcilePlugins`)——装本 bundle 只应用**本** patch,成员自己的 patch 不被应用,任何一行都不会挂两次。成员单独安装仍自挂载;重叠由 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**(`MODE` / `FAMILY_MEMBERS`),让包有可构建的 `lib/`(pack-dist 的硬性要求)。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/learning`)。问题与贡献请移步该仓库。
