# Agent Note: gen-typert overlay——harness 移除后的生成根

Status: implemented

[English](2026-08-16-gen-typert-overlay.md) | 中文

## Problem

harness 提交"remove migrated plugin packages now hosted in dsh-plugins"(2026-08-16)删除了 message-tools、file-preview、local-agent 的仓内副本。`scripts/gen-typert.mts` 原本在 harness checkout 上运行 `WorkspaceTypertGenerator` 生成它们的 Typert 面产物,因此三个包的构建全部失败(`no host artifact generated`)。该 analyzer 与 monorepo 耦合:Remote 标记检测和合并接口的面归属要求被贡献的宿主包(typert-protocol、session 等)是生成根下已注册的工作区*源码*包——npm 安装的副本永远满足不了。

第一版 overlay 即使在 `GEN_TYPERT_ONLY` 只选择一个输出包时也会复制所有已注册的社区 Typert 插件。因此,限定 capability-catalog 的构建会先读取 message-tools,随后读取其他每个 Typert 兄弟;移除任何无关兄弟源码都会让目标构建失败。这违反了插件独立构建的仓库规则,也使该过滤器无法隔离损坏或缺失的邻包。

## Decision

生成在 scratch **overlay**(`$DSH_HOME/scratch/typert-overlay`)上进行:用 APFS clonefile 复制 harness checkout(packages、vendor、native、apps、node_modules、面 tsconfig),再把选中的社区插件包以真实目录复制进去,并从 overlay 的 `tsconfig.host.json` 引用。必须是真实目录:analyzer 对包根做 realpath,解析到 `<root>/packages` 之外的一律过滤。每个进程自建一份 overlay(并发的 `pnpm -r build` 调用不共享可变 scratch),从当前 harness checkout(`DSH_HARNESS`)全新 clone,生成结束后删除;harness checkout 本身从不被修改。复制进去的 manifest 已带 `@khorsheed` 自名,生成器原生盖入正确的 owner,原来的 sourceName→distName 改写步骤随之消失。

`GEN_TYPERT_ONLY` 在 overlay 建立前解析出选中包集合。源码复制、`@khorsheed/*` 路径映射、aggregate 项目引用、生成输入与写出的产物都使用同一集合。未过滤的仓库构建仍把所有已注册 Typert 插件放进一个批次;包级限定构建既不读取也不要求任何无关插件源码。

## Alternatives considered

- **直接用 npm 解析的 harness 类型,不做 overlay**——否决:`@Remote` 标记检测要求声明所在的注册包是 `@deepseek-ai/dsh-typert-protocol`(或 `declare module` 块),npm d.ts 解析永远得不到。
- **把插件包符号链接进 harness 副本**——否决:analyzer 对包根 realpath,符号链接会解析到根之外而被过滤。
- **每次运行把插件源码复制回真实 harness checkout**——否决:harness checkout 只跟踪不修改;它还是 watchdog 守护的部署 checkout,游离的未提交文件有风险。
- **始终复制所有社区 Typert 插件**——否决:宿主框架源码仍是 analyzer 的共享输入,但无关社区插件是独立产品。要求所有兄弟源码存在会让一个缺失或损坏的插件阻塞每个限定构建,却不贡献选中产物。

## Consequences

- 黄金 diff 验证:message-tools 重新生成的 `lib/typert.host.js` / `typert.remote-client.js` 与 harness 时代产物逐字节一致,唯一差异是 `sourceLocation.file` 路径改为本仓库布局。
- capability-catalog 的五个 Typert 文件从完整注册集合与只含 capability-catalog 的 overlay 生成时逐字节一致。回归测试还会在 message-tools 源码不存在的源树上建立选中复制计划。
- 未过滤构建一次性重生成完整注册集合。限定构建每次只分析一个选中集合;每次调用仍会增加一份 harness clonefile 复制开销。
- overlay 依赖 harness 布局(`tsconfig.host.json`、`packages/typert/generator`);harness 侧重构会在缺失条目检查处响亮失败。
