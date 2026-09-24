# @khorsheed/dsh-bundle-local-agent

[English](README.en.md) | 中文

家族 bundle「本地多Agent」:local-agent 核 + 四个委派 provider(kimi / codex / claude-code / dsh)一次装齐。薄元包——patch 插成员规范行 + npm 依赖带齐成员 + locale 卡面元数据,**自身零运行时代码、零客户端面**(纯组合:不注册任何服务/工具/槽位/命令)。

## 形态:纯组合元包

- **patch 逐字复用成员的规范行**:`cordis.patch.yml` 的每一行(含两条停用官方同名工具行的 bare override)都来自对应成员包自己的 `cordis.patch.yml`,id 与 name 原样。仓级 check:plugins 的 `dsh.bundle.kind: 'family'` sanction 机械钉死这一点:行只允许落在「成员规范行全集」白名单内,成员必须是真实自挂载包,每个成员必须至少贡献一行。
- **装我 = 装一族,不双挂**:成员全部列进 `dependencies`(安装即带齐),同时登记进 `dsh.references`(家族名册供 pack 期与目录层读取)。机制依据:`dsh plugin add` 只把 profile 的**直接依赖**收编进 bundles 层(`reconcilePlugins`)——装本 bundle 只应用**本** patch,成员作为传递依赖到达,它们自己的 patch 不被应用,任何一行都不会挂两次。成员单独 `dsh plugin add` 仍自挂载(仓规不破);两者同装时的行重叠由官方 bundle 详情页的行级开关解决。
- **`src/index.ts` 只导出常量**(`FAMILY_MEMBERS` / `FAMILY_DEPS_ONLY`),让包有可构建的 `lib/`(pack-dist 的硬性要求)。

## 成员

| 成员包 | 行 id | 内容 |
| --- | --- | --- |
| `@khorsheed/dsh-local-agent` | `local-agent` | 家族核:共享 scoped-homes 根、委派门面与 Remote |
| `@khorsheed/dsh-local-agent-kimi` | `local-agent-kimi`, `tool-subagent-kimi` | Kimi CLI harness + `subagent_kimi` 委派工具(可续聊) |
| `@khorsheed/dsh-local-agent-codex` | `local-agent-codex`, `tool-subagent-codex-local`(+ override `tool-subagent-codex`) | Codex CLI harness + `subagent_codex` 委派工具 |
| `@khorsheed/dsh-local-agent-claude-code` | `local-agent-claude-code`, `tool-subagent-claude-code-local`(+ override `tool-subagent-claude-code`) | Claude Code harness + `subagent_claude_code` 委派工具 |
| `@khorsheed/dsh-local-agent-dsh` | `local-agent-dsh` | dsh harness 控制器(Settings → 本地 Agent 开关,默认关) |

无卡库(deps-only,进 `dependencies` 不进 patch 行):`@khorsheed/dsh-local-agent-tool-subagent`(委派工具实现,由 provider 行点名)、`@khorsheed/dsh-local-agent-dsh-headless`(子 dsh 被 provision 面)。它们在清单页不出现,随家族存亡。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-bundle-local-agent
```

挂载后家族全部行就位:各 provider 的委派工具挂在 profile 根(各 agent preset 皆可委派),provider 进程在首次工具调用或 `/kimi`、`/codex`、`/claude-code` 登录前不会启动;dsh harness 默认关,Settings → 本地 Agent 打开后生效。

## Compatibility

- **npm 发布线(`@deepseek-ai/dsh@0.1.5`)**:✅ 完整——纯组合,地板取成员最高者(minHost `0.1.5-rc.1`);成员各自在该线上的个别行为差异(如 token 粒度实时镜像)见各成员自己的 Compatibility 节。
- **源码线 / npm 0.1.7-rc.1+**:✅ 完整(verifiedHost `0.1.7-rc.1`)。

**版本线对照**:`0.1.0` 起要求宿主 `0.1.5-rc.1` 及以后。
