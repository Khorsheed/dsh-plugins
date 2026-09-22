# @khorsheed/dsh-typesafe-tool

[English](README.en.md) | 中文

[`@khorsheed/dsh-typesafe`](https://www.npmjs.com/package/@khorsheed/dsh-typesafe) 的**伴生工具行**：模型可见的 `typesafe_judge` 工具、它的提示词段，以及 `typesafe-decide` skill——**按会话授予**，只出现在引用了它的 agent preset 组合的会话里。服务（`ctx.typesafe`）留在 core；这一行只进 preset，不进 profile 根。

## 形态：不自挂载的伴生包

- **只注册工具，不发布服务**（`ctx.provide` 为零）——preset 挂载面的 isolate-realm 规则只拒服务行，工具行可裸放 preset（官方 `tool-bash` 行同构）。
- **不声明 `dsh.bundle`**：作为依赖安装只让模块可解析，不会自动挂到任何组合。授予入口是 preset 的 `agent.cordis.yml` 按名引用：

  ```yaml
  - id: typesafe-tool
    name: '@khorsheed/dsh-typesafe-tool'
  ```

- **跨包只作为数据提及**：core 包名登记在本包 manifest 的 `dsh.references`，源码里**不 import**、依赖字段里**不出现**——本行 apply 时 `ctx.get('typesafe')` 结构探测。因此两包互不牵连构建顺序，`pnpm check:plugins` 也不需要新增任何跨包边。
- **degrade，不炸**：core 未挂载时整体 no-op 并留一行日志——该 preset 组合照常挂上，只是模型看不到工具。工具注册走 `ctx.inject(['tools'])` 延迟注入（挂载序竞态的历史教训）。
- 工具挂在**本包**名下（origin tag owner = `@khorsheed/dsh-typesafe-tool`），「工具与技能」里归入「插件」。

**配置**（可选）：`tools: false` 时这一行什么都不授予（工具、提示词段、skill 一起收回——对不存在的工具做指导是错误指令，不是无害指令）。

## 授予面：三件东西一起给

| 面 | 内容 |
|---|---|
| 工具 | `typesafe_judge`：`state` + 1–32 个窄问题（`noul` / `choice` / `score`），一次调用批量问完 |
| 提示词段 | `typesafe:judge`：何时用、如何一次问完、答案怎么读、**禁止为 TypeSafe 新建 CLI / 包装进程** |
| skill | `typesafe-decide`：问题设计与使用纪律；同时声明 `metadata.credentials`，让凭据在「工具与技能」里就有输入框 |

## 用法（模型侧）

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

返回是紧凑文本（每题一行）：noul 给概率，choice/score 给答案 + `confidence` + 全分布；失败则给一句诚实的说明，而不是编一个答案。

## 安装

```sh
# core 全局装（服务在 profile 根）
dsh plugin --profile web add @khorsheed/dsh-typesafe
# 伴生行装到 profile 的 node_modules 即可（可解析就行，不会自挂载）
dsh plugin --profile web add @khorsheed/dsh-typesafe-tool
# 然后在目标 preset 的 agent.cordis.yml 加上面那行
```

## 密钥

首次使用前在「**设置 → 工具与技能 → typesafe-decide → 凭据配置**」填一次 `TYPESAFE_API_KEY`（或写 `$DSH_HOME/.env` 后重启）。凭据声明由本包的 skill 携带，写的是宿主凭据库；core 每次调用重新解析。

> 注：`metadata.credentials` 是 capability-catalog 的约定，声明后该值也会以 `DSH_TYPESAFE_API_KEY` 注入 bash 执行（默认隐藏，但仍可能被模型主动 echo）。不愿扩大暴露面就用 `.env` 路径。

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）**：✅ 完整——工具注册进宿主 tools 注册表、贡献提示词段与 runtime skill；0.1.5 官方插件列表的「会话插件」组按 preset 组合呈现本行。core 缺席时行照常挂载、只是不注册任何面（记一行日志）。
- **源码线（deepseek-harness master）**：✅（verifiedHost: 0.1.5-rc.1）——`ctx.get` 探测 + `ctx.inject(['tools'|'systemPrompt'|'skills'])` 均为长期 seam，未见重命名。
- 低于 0.1.5 的宿主未验证，minHost 钉 `0.1.5-rc.1`（与 worktrees-tool / room-tool / datasets-tool 三条伴生行同一档）。
- **发布顺序**：引用伴生行的 pack 必须先有伴生包被发布 / 安装；行解析失败会让该 preset 组合报 broken（实例 boot 不受影响），不是静默降级。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。
