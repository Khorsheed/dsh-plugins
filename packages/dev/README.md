# @khorsheed/dsh-dev-suite

[English](README.en.md) | 中文

开发模式一个包装齐:`dsh-dev` agent preset 连同它授予工具的整个开发家族——local-agent 核与 Kimi / Codex / Claude Code / dsh 四个委派 provider、工作树、多Agent协同、快速决策。清单里只多一张「开发模式」卡片;切到开发模式的会话自动拿到该模式的工具组合。

## 这是什么模式

开发模式 = 官方标准模式的全部能力,外加按会话授予的社区工具:三个 local-agent 委派工具(`subagent_kimi` / `subagent_codex` / `subagent_claude_code`)、worktrees 模型工具、room 协同工具与 typesafe 判断工具。会话在模式选择器里切到「开发模式」即获得这些工具;其它会话一个也看不到。

## 成员

| 成员包 | 行 id | 能力 |
| --- | --- | --- |
| `@khorsheed/dsh-local-agent` | `local-agent` | 家族核:共享 scoped-homes 根、委派门面与 Remote |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi` | Kimi CLI harness;`subagent_kimi` 由本包 `./tool` 入口经 preset 授予 |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex`(+ override `tool-subagent-codex`) | Codex CLI harness;`subagent_codex` 同理按会话授予 |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code`(+ override `tool-subagent-claude-code`) | Claude Code harness;`subagent_claude_code` 同理按会话授予 |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` | dsh harness 控制器(Settings → 本地 Agent 开关,默认关) |
| `@khorsheed/dsh-worktrees` | `worktrees` | 实况展示会话工作树的分支、待提交改动与提交记录 |
| `@khorsheed/dsh-room` | `room` | 把会话升级为有协调者和成员的共享协作空间 |
| `@khorsheed/dsh-typesafe` | `typesafe` | 类型化模型判断原语,供其它插件在代码中调用 |

无卡库(deps-only,进 `dependencies` 不进 patch 行):`@khorsheed/dsh-local-agent-dsh-headless`(子 dsh 被 provision 面)——与 @khorsheed/dsh-bundle-local-agent 同一处理,清单页不出现,随家族存亡。

## 安装

在宿主界面「添加插件」对话框里粘贴包名 `@khorsheed/dsh-dev-suite`(或从市场索引里选它),确认后重启实例——装这一个,成员随依赖一起到达,模式 preset 与家族行由本包的 patch 统一挂载。随后在会话的模式选择器里切到「开发模式」。

命令行等价:

```sh
dsh plugin --profile web add @khorsheed/dsh-dev-suite
```

```sh
dsh plugin --profile web remove @khorsheed/dsh-dev-suite
```

卸载即整族移除(含模式 preset);想保留家族、只关某一行,用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.7-rc.1`):✅ 完整——纯组合;成员地板最高 `0.1.5-rc.1`,但模式 preset 行(`@deepseek-ai/dsh-agent-preset` 声明行)在 `0.1.7-rc.1` 才存在,故地板取两者较高者。各成员的个别行为差异见各成员自己的 Compatibility 节。
- 源码线(deepseek-harness master):✅ 完整(verifiedHost: 0.2.1-rc.1)。

**版本线对照**:`0.1.0` 起要求宿主 `0.1.7-rc.1` 及以后。

## 已知限制

- **只装 dsh 侧集成**——各家 CLI 本体(`kimi` / `codex` / `claude`)需在 `PATH` 上自行安装,登录各走各的 `/<harness> login`;本包不代装、不代登录。
- **卸载是整族的**——remove 本包会把全部成员一起移除,没有「从 bundle 里退掉单个成员」的操作;单行停用请用 bundle 详情页的行级开关。
- **preset 行的正本就在本包**——它曾镜像自 @khorsheed/dsh-presets,该包已于 2026-10-24 退役。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**模式包 = 家族整合包 + 一行模式 preset。** `cordis.patch.yml` 的成员行(含两条停用官方同名工具行的 bare override)逐字来自对应成员包自己的 `cordis.patch.yml`;末尾一行 `preset-dsh-dev`(`@deepseek-ai/dsh-agent-preset` 声明)是本包自有的正本(曾镜像自已退役的 `@khorsheed/dsh-presets`)。仓级 check:plugins 的 `dsh.bundle.kind: 'mode'` sanction 机械钉死整个形状:行只允许落在「成员规范行全集 + 恰好一行 preset-<mode>」内,成员必须是真实自挂载包,每个成员至少贡献一行,mode 值全树唯一。

**装我 = 装一族 + 一个模式,不双挂。** 成员全部列进 `dependencies`(安装即带齐),同时登记进 `dsh.references`(家族名册供 pack 期与目录层读取)。`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层(`reconcilePlugins`)——装本 bundle 只应用**本** patch,成员自己的 patch 不被应用,任何一行都不会挂两次。成员单独安装仍自挂载;重叠由 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**(`MODE` / `FAMILY_MEMBERS` / `FAMILY_DEPS_ONLY`),让包有可构建的 `lib/`(pack-dist 的硬性要求)。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/dev`)。问题与贡献请移步该仓库。
