# @khorsheed/dsh-writing

[English](README.en.md) | 中文

写作模式一个包装齐:`dsh-writing` agent preset 连同写作家族——灵感画布与它的「长篇小说」体裁。清单里只多一张「写作模式」卡片;切到写作模式的会话自动拿到画布协作工具,绑定长篇小说画布的会话另有小说工具。

## 这是什么模式

写作模式 = 作家身份与文风约束(任务模式、双语文风规则、声音规则)、文件读写与网页检索、Skills,以及按会话授予的画布工具(`canvas_read` / `canvas_write` / `canvas_propose_type`);会话绑定到长篇小说画布时,再出现 `novel_*` 章节/台账/待审工具。会话在模式选择器里切到「写作模式」即获得这些工具;其它会话一个也看不到。

## 成员

| 成员包 | 行 id | 能力 |
| --- | --- | --- |
| `@khorsheed/dsh-canvas` | `canvas` | 灵感画布:卡片、连线与模型提议的主题画布(canvasStore/canvasBoard 服务与界面) |
| `@khorsheed/dsh-canvas-novel` | `canvas-novel`、`canvas-novel-agent`(出厂停用) | 「长篇小说」体裁:人物/伏笔/章节的作品记忆引擎、对账闸门、画布里的待审条与章节页 |

画布工具行(canvas `./agent`)在成员自己的 patch 里默认对**所有**会话开放;模式包把它收窄为仅写作模式会话——patch 里以一条 `disabled: true` 覆写实现(两行同活会同名双注册、直接无法启动,成员 patch 注释写明了这条规则)。

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-writing`(或从市场索引里选它),确认后重启实例——装这一个,成员随依赖一起到达,模式 preset 与家族行由本包的 patch 统一挂载。随后在会话的模式选择器里切到「写作模式」。

命令行等价:

```sh
dsh plugin --profile web add @khorsheed/dsh-writing
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-writing
```

卸载即整族移除(含模式 preset);想保留家族、只关某一行,用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.2.0-rc.2`):✅ 完整——纯组合,地板取成员最高者(minHost `0.2.0-rc.2`,即 canvas-novel 的地板;canvas 本身 `0.1.5-rc.1` 起)。各成员的个别行为差异见各成员自己的 Compatibility 节。
- 源码线(deepseek-harness master):✅ 完整(verifiedHost: 0.2.1-rc.1)。

**版本线对照**:`0.1.0` 起要求宿主 `0.2.0-rc.2` 及以后。

## 已知限制

- **卸载是整族的**——remove 本包会把全部成员一起移除,没有「从 bundle 里退掉单个成员」的操作;单行停用请用 bundle 详情页的行级开关。
- **preset 行镜像自 @khorsheed/dsh-presets**——两处内容逐字一致,由仓级 parity spec 钉住;presets 包退役后此处为正本。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**模式包 = 家族整合包 + 一行模式 preset。** `cordis.patch.yml` 的成员行逐字来自对应成员包自己的 `cordis.patch.yml`;末尾一行 `preset-dsh-writing`(`@deepseek-ai/dsh-agent-preset` 声明)逐字镜像自 `@khorsheed/dsh-presets`,由 `scripts/preset-mode-parity.spec.ts` 钉住两边 plugins 组合与展示字段不漂移。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死整个形状:行只允许落在「成员规范行全集 + 恰好一行 preset-<mode>」内,成员必须是真实自挂载包,每个成员至少贡献一行,mode 值全树唯一。

**装我 = 装一族 + 一个模式,不双挂。** 成员全部列进 `dependencies`(安装即带齐),同时登记进 `dsh.references`(家族名册供 pack 期与目录层读取)。`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层(`reconcilePlugins`)——装本 bundle 只应用**本** patch,成员自己的 patch 不被应用,任何一行都不会挂两次。成员单独安装仍自挂载;重叠由 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**(`MODE` / `FAMILY_MEMBERS` / `FAMILY_ROOT_OVERRIDES`),让包有可构建的 `lib/`(pack-dist 的硬性要求)。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/writing`)。问题与贡献请移步该仓库。
