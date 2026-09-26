# @khorsheed/dsh-bundle-local-agent

[English](README.en.md) | 中文

让 dsh 把活儿派给本机的其他 CLI 智能体——Kimi、Codex、Claude Code、dsh 自己——一个包装齐整个 local-agent 家族。

一个会话,多种智能体:主线 agent 判断哪段任务适合谁,委派工具把任务连同要求交过去,被委派的 CLI 跑完把结果带回当前对话(过程在「子代理」面可见)。这个家族 bundle 把家族核与四个委派 provider 一次装齐,清单里只多一张「本地多Agent」卡片,不用逐包挑选。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/08-local-agent.png" width="640" alt="设置里的四张 Local Agent 卡片:Kimi、Codex、dsh、Claude Code,卡头状态点显示各 provider 授权状态">

## 特性

- **一次装齐一族**——local-agent 核(共享 scoped-homes 根、`/<harness> login|sessions` 命令族、委派门面与 Remote)加四个委派 provider(kimi / codex / claude-code / dsh),连带家族工具库,一条 `dsh plugin add` 全部就位。
- **委派工具原位替换**——`subagent_kimi` / `subagent_codex` / `subagent_claude_code` 与官方子代理工具同名(toolName 不变,preset 与 prompt 不受影响),另带可选 `resume` 参数:后续轮次继续同一个 CLI 会话,而不是每次冷启动。
- **进程不常驻**——委派默认一次性进程;没有委派或登录动作时,本机不会多起任何 provider 进程。
- **清单里只有一张卡**——locale 卡面元数据把整族归成一张「本地多Agent」卡;两个无卡工具库随家族存亡,不单独出现。
- **纯组合,零运行时**——本包不注册任何服务/工具/槽位/命令;patch 逐字复用成员的规范行,装我不双挂(机制见文末实现原理)。

## 成员

| 成员包 | 行 id | 内容 |
| --- | --- | --- |
| `@khorsheed/dsh-local-agent` | `local-agent` | 家族核:共享 scoped-homes 根、委派门面与 Remote |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi`, `tool-subagent-kimi` | Kimi CLI harness + `subagent_kimi` 委派工具 |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex`, `tool-subagent-codex-local`(+ override `tool-subagent-codex`) | Codex CLI harness + `subagent_codex` 委派工具 |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code`, `tool-subagent-claude-code-local`(+ override `tool-subagent-claude-code`) | Claude Code harness + `subagent_claude_code` 委派工具 |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` | dsh harness 控制器(Settings → 本地 Agent 开关,默认关) |

无卡库(deps-only,进 `dependencies` 不进 patch 行):`@khorsheed/dsh-local-agent-tool-subagent`(委派工具实现,由 provider 行点名)、`@khorsheed/dsh-local-agent-dsh-headless`(子 dsh 被 provision 面)。它们在清单页不出现,随家族存亡。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-web-basic/main/docs/screenshots/bundle-local-agent.png" width="640" alt="插件清单里「本地多Agent」家族卡的详情页:全部成员行逐行列出,带行级启停开关">

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-local-agent
```

重启 web 实例后生效。挂载后家族全部行就位:各 provider 的 CLI 登录走各自的 `/<harness> login`(如 `/kimi login`);dsh harness 默认关,Settings → 本地 Agent 打开后生效。

```sh
dsh plugin --profile web remove @khorsheed/dsh-bundle-local-agent
```

卸载即整族移除;想保留家族、只关某一行,用 bundle 详情页的行级开关。

## Compatibility

- npm 发布线(`@deepseek-ai/dsh@0.1.5-rc.1`):✅ 完整——纯组合,地板取成员最高者(minHost `0.1.5-rc.1`,即核与四个 provider 的地板;deps-only 库 local-agent-tool-subagent / local-agent-dsh-headless 地板更低)。地板之上各成员的个别行为差异(如 0.1.5 上 token 粒度的实时镜像)见各成员自己的 Compatibility 节。
- 源码线(deepseek-harness master):✅ 完整(verifiedHost: 0.1.7-rc.2)。

**版本线对照**:`0.1.0` 起要求宿主 `0.1.5-rc.1` 及以后。

## 已知限制

- **只装 dsh 侧集成**——各家 CLI 本体(`kimi` / `codex` / `claude`)需在 `PATH` 上自行安装,登录也各走各的 `/<harness> login`;bundle 不代装、不代登录。
- **卸载是整族的**——remove 本包会把全部成员一起移除,没有「从 bundle 里退掉单个成员」的操作;单行停用请用 bundle 详情页的行级开关。

## 实现原理

<details>
<summary>内部结构(点击展开)</summary>

**纯组合元包。** `cordis.patch.yml` 的每一行(含两条停用官方同名工具行的 bare override)都来自对应成员包自己的 `cordis.patch.yml`,id 与 name 原样。仓级 check:plugins 的 `dsh.bundle.kind: 'family'` sanction 机械钉死这一点:行只允许落在「成员规范行全集」白名单内,成员必须是真实自挂载包,每个成员必须至少贡献一行。

**装我 = 装一族,不双挂。** 成员全部列进 `dependencies`(安装即带齐),同时登记进 `dsh.references`(家族名册供 pack 期与目录层读取)。机制依据:`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层(`reconcilePlugins`)——装本 bundle 只应用**本** patch,成员作为传递依赖到达,它们自己的 patch 不被应用,任何一行都不会挂两次。成员单独 `dsh plugin add` 仍自挂载(仓规不破);两者同装时的行重叠由官方 bundle 详情页的行级开关解决。

**`src/index.ts` 只导出常量**(`FAMILY_MEMBERS` / `FAMILY_DEPS_ONLY`),让包有可构建的 `lib/`(pack-dist 的硬性要求)。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo(`packages/bundle-local-agent`)。问题与贡献请移步该仓库。
