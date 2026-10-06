# bundle-learning（学习模式 preset）

一句话：**装上它，library 的 agent 能力（library_read / library_write / library_assess 三工具、教练 prompt 段、每轮绑定上下文）只在「学习模式」preset 的会话里生效**；普通会话的工具列表和系统提示里完全没有图书馆工具的痕迹。

本包是**声明式 preset bundle**（`dsh.bundle.kind: preset-declarations`，AGENTS.md 约定）：patch 只含一行 `@deepseek-ai/dsh-agent-preset`（loader id `preset-learning`），没有自己的运行时代码。

## 它做什么

学习 preset 是一个具名作用域。切到它的会话组合出：

- **persona**：精读教练——陪读而非代读（随讲随问、苏格拉底式追问）；用学习者的语言；图书馆工具即记忆；不编造书的内容，书与照片优先于记忆；学习者的薄弱点优先；判题两步走（会话里判、`library_assess` 落账）。
- **library 的 agent 面**：在作用域内挂载 `@khorsheed/dsh-library/tool`（config `tools: all`），并在本 scope 里静音根上与学习无关的提示段（宿主源码路径、Web GUI 地址、交付物链接写法）与 `list_capabilities` 工具。
- **学习场景工具单**（官方 standard 的严格节食版）：tool-ask-user（选项目、选书、选版本）、tool-web（核对版本与目录、引用网上原文）、compaction 组（长会话折叠）。不带 fs（书不上传，没有书籍文件）、skill（用法写在工具描述里）、todo（路线图就是学习计划），也没有 shell / goal / plan-mode / 委派。

## 安装与启用

```sh
dsh plugin --profile <name> add @khorsheed/dsh-library
dsh plugin --profile <name> add @khorsheed/dsh-bundle-learning
```

- **只装 library**：得到图书馆 tab 与数据面；任何会话都没有 library 工具。
- **再装 bundle-learning**：出现「学习模式」preset；把会话切到它，三个工具 + 教练 prompt 段 + 绑定上下文才存在。

缺席行为：只装 bundle-learning 不装 library 时，preset 行的授予保持 pending（注册表显示 `waiting for library`），装上 library 即生效。宿主 0.1.7-rc.1 之前的行没有 `@deepseek-ai/dsh-agent-preset` 行类型，本包无法挂载（见 package.json `dsh.compat`）。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| npm 发布线（0.2.0-rc.x） | 完整支持（`minHost: 0.1.7-rc.1`——preset 行类型的最低线） |
| deepseek-harness master（0.2.0-rc.2 开发线） | 已验证（`verifiedHost: 0.2.0-rc.2`） |
