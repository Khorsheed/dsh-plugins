# @khorsheed/dsh-typesafe-tool

[English](README.en.md) | 中文

「这条消息要不要回？归谁管？有多急？」——把这类语义判断一次问完，拿回带置信度的类型化答案，而不是一段还要再解析的散文。

agent 干活总会遇到代码定不了的语义判断：以前不是拍脑袋猜，就是现场写一个「prompt 再解析」的脆弱步骤。这个包把 TypeSafe（System One / Jev）的快判断包装成模型工具 `typesafe_judge`，连同使用指导和技能一起**按会话授予**——只有引用了它的 agent preset 组合的会话才看得到。它是 [`@khorsheed/dsh-typesafe`](https://www.npmjs.com/package/@khorsheed/dsh-typesafe) 的伴生工具行：服务（`ctx.typesafe`）留在 core，这一行只进 preset、不进 profile 根。

## 特性

- **一次调用批量问完**——`typesafe_judge` 接收一段 `state` 加 1–32 个窄问题：`noul`（是/否概率）、`choice`（给定集合选一）、`score`（有序评级）。返回紧凑文本，每题一行：noul 给两位小数概率，choice/score 给答案 + `confidence` + 全分布。
- **工具、指导、技能三件套同给同收**——提示词段 `typesafe:judge`（何时用、如何批量、怎么读答案、**禁止为 TypeSafe 新建 CLI / 包装进程**）与 `typesafe-decide` skill（问题设计与使用纪律）随工具一起授予。
- **按会话授予**——授予入口是 preset 的 `agent.cordis.yml` 按名引用本行；没引用它的 preset 的会话完全无感。
- **core 缺席就 pending，不炸**——core 服务声明为 `inject = ['typesafe']`（同族 companion 例外）：core 未挂载时该行保持 pending（注册表审计显示 `waiting for typesafe`），preset 组合照常挂上、不报错；core 出现后行激活，工具、提示词段与 skill 一起注册生效。注册面走 `ctx.inject` 延迟注入，挂载顺序竞不到它。
- **归属清晰**——工具的 origin tag 挂在**本包**名下（owner `@khorsheed/dsh-typesafe-tool`），在「工具与技能」里归入「插件」。
- **凭据有输入框**——skill 声明 `metadata.credentials`，`TYPESAFE_API_KEY` 在「设置 → 工具与技能」里就有密码输入框，不用手改配置文件。

### 用法（模型侧）

```jsonc
{
  "state": "服务器又挂了，客户在催",
  "questions": [
    { "id": "needs_reply", "type": "noul", "instructions": "这条消息是否需要有人回复？" },
    { "id": "urgency", "type": "score", "instructions": "紧急程度", "levels": ["可以等", "本周", "今天"] },
    { "id": "topic", "type": "choice", "instructions": "属于哪个主题", "choices": { "infra": "服务器/部署问题", "billing": "付款与账单", "other": "都不像" } }
  ]
}
```

成功时首行给出模型、延迟、缓存命中与 token 用量，其后每题一行；失败则返回一句诚实的说明（缺哪个凭据或网络依赖），绝不编一个答案。

## 安装

core 仍全局安装（服务在 profile 根）；伴生行装进 profile 的 node_modules 即可——它**不自挂载**，只保证模块可解析：

```sh
dsh plugin --profile web add @khorsheed/dsh-typesafe
dsh plugin --profile web add @khorsheed/dsh-typesafe-tool
```

然后在目标 preset 的 `agent.cordis.yml` 按名引用这一行：

```yaml
- id: typesafe-tool
  name: '@khorsheed/dsh-typesafe-tool'
```

组合变更要重启 web 实例后生效。卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-typesafe-tool
```

卸载只断模块解析——记得同步从各 preset 的 `agent.cordis.yml` 删掉引用行，否则那些 preset 组合会报 broken（实例 boot 不受影响，但这不是静默降级）。

**配置**（可选，写在 preset 行上）：`tools: false` 时这一行什么都不授予——工具、提示词段、skill 一起收回（对不存在的工具做指导是错误指令，不是无害指令）。

## 密钥

首次使用前在「**设置 → 工具与技能 → typesafe-decide → 凭据配置**」填一次 `TYPESAFE_API_KEY`（或写进 `$DSH_HOME/.env` 后重启）。凭据声明由本包的 skill 携带，写的是宿主凭据库；core 每次调用重新解析。

> 注：`metadata.credentials` 是 capability-catalog 的约定，声明后该值也会以 `DSH_TYPESAFE_API_KEY` 注入 bash 执行（默认隐藏，但仍可能被模型主动 echo）。不愿扩大暴露面就用 `.env` 路径。

## Compatibility

- npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）：✅ 完整——工具注册进宿主 tools 注册表、贡献提示词段与 runtime skill；0.1.5 官方插件列表的「会话插件」组按 preset 组合呈现本行。core 缺席时组合照常挂载，该行保持 pending（注册表审计显示 `waiting for typesafe`），core 出现后行激活、三个注册面一起生效。
- 源码线（deepseek-harness master）：✅（verifiedHost: 0.1.5-rc.1）——core 服务的声明式 `inject` + `ctx.inject(['tools'|'systemPrompt'|'skills'])` 延迟注入均为长期 seam，未见重命名；行内 `ctx.get('typesafe')` 仅留作防御性直调守卫。低于 0.1.5 的宿主未验证，minHost 钉 `0.1.5-rc.1`（与 room-tool / datasets-tool 两条伴生行同一档）。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。

## 已知限制

- **只授予，不带服务**——本行不提供 `ctx.typesafe`；core（`@khorsheed/dsh-typesafe`）未装时该行保持 pending（注册表审计显示 `waiting for typesafe`），工具不会出现在任何会话里，core 装好后行自动激活。
- **引用与安装必须同步**——preset 引用一个解析不了的行会让该 preset 组合报 broken，而不是静默降级；装包、卸包、改 `agent.cordis.yml` 要一起走。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**不自挂载的伴生包。** 只注册工具、不发布服务（`ctx.provide` 为零）——preset 挂载面的 isolate-realm 规则只拒服务行，工具行可裸放 preset（官方 `tool-bash` 行同构）。包不声明 `dsh.bundle`：作为依赖安装只让模块可解析（plain dependency），不会自动挂进任何组合。core 包名只作为数据登记在 manifest 的 `dsh.references`——源码**不 import**、依赖字段**不出现**。两包因此互不牵连构建顺序，`pnpm check:plugins` 也不需要新增跨包边。

**core 服务走声明式 inject，不再一次性探测。** `export const inject = ['typesafe']`（同族 companion 例外，见 `scripts/check-plugin-independence.ts` 的 COMMUNITY_SERVICE_INJECTORS）：preset 的 standing scope 在注册表激活时挂载，早于 profile 靠后 bundle 行提供 core，apply 时一次性 `ctx.get` 探测看到 ABSENT 后没有任何东西会重跑该行（rc.1 挂载序；2026-09-27 3080 生产实证）。声明式 inject 让该行 pending 到 core 提供再整体 apply：pending 期间注册表审计显示 `waiting for typesafe`，preset 挂载本身不受影响。行内 `ctx.get('typesafe')` 守卫保留为防御性直调路径（测试不经 loader 的 inject 机制直调 apply）。

**三个注册面都走延迟注入。** `ctx.inject(['tools'])` 注册 `typesafe_judge`——apply 时直接 `ctx.get('tools')` 会输掉与注册表自身挂载顺序的竞态、静默注册不上（挂载序竞态的历史教训）；`ctx.inject(['systemPrompt'])` 贡献提示词段 `typesafe:judge`（order 152）；`ctx.inject(['skills'])` 注册随包的 `skills/typesafe-decide/SKILL.md`（source `runtime`、provider 本包名；文件缺失只告警一行，不炸 boot），并借 skill 的 `metadata.credentials` 给凭据一个「工具与技能」里的输入框。

**防御性入参与紧凑渲染。** 空问题、超过 32 题、重复 id、choice 缺 `choices`、score 缺 `levels` 都在调用服务前拒绝并返回原因——wire 上的任何东西都按未知输入读。答案渲染为模型可直接消费的紧凑文本：首行 `模型 延迟ms [cached] [tokens=in/out]`，其后每题一行（noul 两位小数概率；choice/score 给答案——score 附 level 文案——加 `confidence=` 与全分布）；失败输出一句说明，并明确提示模型不要盲目重试、不要编答案。

**导出面。** 入口导出 `apply` / `inject` / `Config` / `name`，以及 `typesafeJudgeTool`、`formatResult`、`toSeamQuestions`、`parseJudgeArgs` 等纯函数（测试面）；无浏览器半部分。

</details>

## 开发

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/typesafe-tool`）。问题与贡献请移步该仓库。
