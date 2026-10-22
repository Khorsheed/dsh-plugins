# @khorsheed/dsh-gamedev

[English](README.en.md) | 中文

游戏开发模式一个包装齐:`dsh-gamedev` agent preset 连同游戏操作台——和 agent 一起做小游戏:对话里定玩法与细节,右栏「游戏」看分章节策划、试玩每轮通过检查的最新版本。清单里只多一张「游戏开发模式」卡片;切到该模式的会话自动拿到 `game_open` / `game_read` / `game_publish` 工具与游戏技能。

## 这是什么模式

游戏开发模式 = 游戏开发者兼策划导师人格加游戏工作台:定玩法时给出两三个具体选项由你拍板,尽早做出能玩的最小版本再迭代;每轮改动后插件自动跑检查,不过就把结果送回会话当场修。会话在模式选择器里切到「游戏开发模式」即获得这些;其它会话一个也看不到。

## 成员

| 成员包 | 行 id | 能力 |
| --- | --- | --- |
| `@khorsheed/dsh-game` | `game`、`game-agent`(由本包 preset 授予) | 游戏开发:gameStore 服务、右栏「游戏」策划操作台(试玩调参、外观编辑、分章节策划、版本与回滚)、每轮结束自动检查 |

游戏工具与技能(game `./agent` 入口)不在 profile 根挂行,由本包 preset 行的 `game-agent` 授予点按会话授予;成员单装时其自有 patch 会让该入口全局可用,宿主 0.2.x 下本模式会话见 scoped 副本遮蔽全局行,不再双注册崩 boot(宿主 scoped.spec.ts 钉死)。

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-gamedev`(或从市场索引里选它),确认后重启实例——装这一个,成员随依赖一起到达,模式 preset 与成员行由本包的 patch 统一挂载。随后在会话的模式选择器里切到「游戏开发模式」。

命令行等价:

```sh
dsh plugin --profile web add @khorsheed/dsh-gamedev
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-gamedev
```

卸载即整族移除(含模式 preset);想保留成员、只关某一行,用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.2.0-rc.1`):✅ 完整——纯组合,地板即成员自身(minHost `0.2.0-rc.1`,game 的地板)。成员行为细节见其自己的 Compatibility 节。
- 源码线(deepseek-harness master):✅ 完整(verifiedHost: 0.2.1-rc.1)。

**版本线对照**:`0.1.0` 起要求宿主 `0.2.0-rc.1` 及以后。

## 已知限制

- **卸载是整族的**——remove 本包会把成员一起移除;想只关某一行,用 bundle 详情页的行级开关。
- **preset 行镜像自 @khorsheed/dsh-presets**——两处内容逐字一致,由仓级 parity spec 钉住;presets 包退役后此处为正本。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**模式包 = 家族整合包 + 一行模式 preset。** `cordis.patch.yml` 的成员行逐字来自成员包自己的 `cordis.patch.yml`(`game-agent` 伴生组合行不进 patch,只活在下方 preset 组合里);末尾一行 `preset-dsh-gamedev`(`@deepseek-ai/dsh-agent-preset` 声明)逐字镜像自 `@khorsheed/dsh-presets`,由 `scripts/preset-mode-parity.spec.ts` 钉住两边 plugins 组合与展示字段不漂移。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死整个形状:行只允许落在「成员规范行全集 − 伴生组合行 + 恰好一行 preset-<mode>」内,被减去的伴生行必须由本包 preset 组合点名授予,成员必须是真实自挂载包,每个成员至少贡献一行,mode 值全树唯一。

**装我 = 装成员 + 一个模式,不双挂。** 成员列进 `dependencies`(安装即带齐),同时登记进 `dsh.references`(家族名册供 pack 期与目录层读取)。`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层(`reconcilePlugins`)——装本 bundle 只应用**本** patch,成员自己的 patch 不被应用,任何一行都不会挂两次。成员单独安装仍自挂载;重叠由 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**(`MODE` / `FAMILY_MEMBERS`),让包有可构建的 `lib/`(pack-dist 的硬性要求)。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/gamedev`)。问题与贡献请移步该仓库。
