# bundle-writing（写作模式 preset）

一句话：**装上它，canvas-novel 的 agent 能力（novel_read/write/extract 三工具、novel:pointer 轻指引、novel skill）只在「写作」preset 的会话里生效**；普通会话的工具列表和系统提示里完全没有小说工具的痕迹。

本包是**声明式 preset bundle**（`dsh.bundle.kind: preset-declarations`，AGENTS.md 约定）：patch 只含一行 `@deepseek-ai/dsh-agent-preset`（loader id `preset-writing`），没有自己的运行时代码。

## 它做什么

写作 preset 是一个具名作用域。切到它的会话组合出：

- **persona**：长篇小说协作编辑（追问灵感、摆伏笔与人物上台面、守设定一致性、如实报对账命中与落空；作品资产以 novel_* 工具取到的为准）。
- **canvas-novel 的 agent 面**：在作用域内挂载 `@khorsheed/dsh-canvas-novel/agent`（canvas-novel 出厂 patch 把同一行停在 profile 根禁用——两者绝不能同时生效，否则同名工具双注册炸 boot）。
- **写作场景工具单**：tool-fs（正文读写）、skill-filesystem + tool-skill（novel skill 经此加载）、tool-ask-user（确认闸门）、compaction 组（长会话折叠）。没有 shell/搜索/委派/jobs——写作流程用不到。

## 安装与启用

```sh
dsh plugin --profile <name> add @khorsheed/dsh-canvas-novel
dsh plugin --profile <name> add @khorsheed/dsh-bundle-writing
```

- **只装 canvas-novel**：得到小说引擎的 store，画布里多出「长篇小说」体裁；任何会话都没有 novel 工具。
- **再装 bundle-writing**：出现「写作」preset；把会话切到它，三工具 + 轻指引 + skill 才存在。

缺席行为：只装 bundle-writing 不装 canvas-novel 时，preset 行的授予保持惰性（工具不存在、不炸）；装上 canvas-novel 即生效。宿主 0.1.7-rc.1 之前的行没有 `@deepseek-ai/dsh-agent-preset` 行类型，本包无法挂载（见 package.json `dsh.compat`）。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| npm release 0.1.7-rc.1 起（含 0.2.0-rc.2） | ✅（verifiedHost `0.2.0-rc.2`）：preset 行类型与全部官方工具行均在场 |
| 0.1.5 及更早 | ❌ 无 `@deepseek-ai/dsh-agent-preset` 行类型，无法挂载 |

English: [README.en.md](README.en.md)
