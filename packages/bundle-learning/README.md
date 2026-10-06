# bundle-learning（学习模式 preset）

一句话：**装上它，library 的 agent 能力（library_read / library_write / library_assess 三工具、精读教练 prompt 段、library skill）只在「学习模式」preset 的会话里生效**；普通会话的工具列表和系统提示里完全没有图书馆工具的痕迹。

本包是**声明式 preset bundle**（`dsh.bundle.kind: preset-declarations`，AGENTS.md 约定）：patch 只含一行 `@deepseek-ai/dsh-agent-preset`（loader id `preset-learning`），没有自己的运行时代码。

## 它做什么

学习 preset 是一个具名作用域。切到它的会话组合出：

- **persona**：精读教练——陪读而非代读（解释随读随讲、苏格拉底式追问）；图书馆工具即记忆（词条随读随记，照片笔记转录入词书并带照片出处）；判题两步走（会话里判、`library_assess` 落账）；到期词卡先行。
- **library 的 agent 面**：在作用域内挂载 `@khorsheed/dsh-library/tool`（config `tools: all`）。
- **学习场景工具单**（官方 standard 节食版，写作模式先例）：tool-fs（书籍源文件）、skill-filesystem + tool-skill（library skill 经此加载）、tool-ask-user（确认与选择）、tool-todo（学习任务）、tool-web（查资料）、compaction 组（长会话折叠）。没有 shell / goal / plan-mode / 委派——学习流程用不到。

## 安装与启用

```sh
dsh plugin --profile <name> add @khorsheed/dsh-library
dsh plugin --profile <name> add @khorsheed/dsh-bundle-learning
```

- **只装 library**：得到图书馆 tab 与数据面；任何会话都没有 library 工具。
- **再装 bundle-learning**：出现「学习模式」preset；把会话切到它，三个工具 + 教练 prompt 段 + skill 才存在。

缺席行为：只装 bundle-learning 不装 library 时，preset 行的授予保持 pending（注册表显示 `waiting for library`），装上 library 即生效。宿主 0.1.7-rc.1 之前的行没有 `@deepseek-ai/dsh-agent-preset` 行类型，本包无法挂载（见 package.json `dsh.compat`）。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| npm 发布线（0.2.0-rc.x） | 完整支持（`minHost: 0.1.7-rc.1`——preset 行类型的最低线） |
| deepseek-harness master（0.2.0-rc.2 开发线） | 已验证（`verifiedHost: 0.2.0-rc.2`） |
