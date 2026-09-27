# @khorsheed/dsh-presets

[English](README.en.md) | 中文

社区三个 agent preset 的声明式 bundle：`dev`（开发模式）、`dsh-eval`（评测模式）、`dsh-writing`（写作模式），各为宿主 0.1.7-rc.1 preset 机制里的一行 `@deepseek-ai/dsh-agent-preset` 声明（loader 行 id 约定 `preset-<id>`）。本包是 0.1.5 时代三个目录式 preset（`$DSH_HOME/.agent-presets/<id>/`）的迁移——rc.1 不再读取该目录，preset 改由 bundle patch 声明。

## 形态：纯声明包

- **无运行时代码、无客户端面**：`cordis.patch.yml` 的一个 `- insert:` 列表携带全部三行声明；`src/index.ts` 只导出 `PRESET_IDS` 常量，让包有可构建的 `lib/`（pack-dist 的硬性要求）。清单以 `dsh.bundle.kind: 'preset-declarations'` 声明这一形态——check:plugins 据此改钉 preset 行约定（行名只能是 `@deepseek-ai/dsh-agent-preset`、行 id 必须是 `preset-<id>`），取代自挂载包的「自有运行时行」身份三角。
- **行由官方插件解释**：声明的激活、schema 校验、会话组合都归宿主的 `@deepseek-ai/dsh-agent-preset` / `-registry`（0.1.7-rc.1 起随官方 web-app bundle 发布，本包以 optional peer 声明）。
- **社区工具行按名引用、部署层解析**：preset 组合里的 `@khorsheed/dsh-local-agent-tool-subagent`、`-worktrees/tool`、`-room/tool`、`-typesafe-tool`、`-datasets-tool`、`-eval-tool`、`-canvas/agent` 行只命名模块——与旧目录式 preset 一样，这些包须装进同一个 profile 才能解析；它们是清单 `dsh.references` 里的数据引用，**不是** npm 依赖边。引用了装不上的模块的 preset 会带着诊断留在名册上（官方机制），不会炸掉宿主。

## 三个 preset 的迁移来源

| preset | 名称 | order | 来源与核对结果 |
| --- | --- | --- | --- |
| `dev` | 开发模式 | 10 | 官方部分以 rc.1 `standard.patch.yml` 全文重基（0.1.5 复制件已漂移：`workflow-worker-thread` 改名 `workflow-ptc`、`tool-ralph` 上游默认停用、新增停用的 `tool-plugin-manager` 行），末尾逐字追加现行 dev 的六条社区工具行（3× local-agent 委派 + worktrees/room/typesafe）。 |
| `dsh-eval` | 评测模式 | 0 | `profiles/web-eval/presets/eval` 逐行迁移：无 Shell/无工作流的只读+委派组合（冻结决策 12），官方包名对照 rc.1 名册**零改名**；附 `datasets-tool`（`tools: authoring`）与 `eval-tool`（`tools: all`）两条伴生行。 |
| `dsh-writing` | 写作模式 | — | `profiles/web/presets/dsh-writing` 逐行迁移（`tool-ralph` 保持启用是本预设自己的决定）；唯一改名 `workflow-worker-thread` → `workflow-ptc`；附 `canvas/agent` 行。 |

展示字段（`name`/`description`/`order`）来自各旧 `preset.yml`，描述文字保持中文原文。

## 安装

```sh
dsh plugin --profile web add @khorsheed/dsh-presets
```

挂载后三个 preset 出现在会话的模式选择里。各 preset 引用的社区伴生包按需安装（例：开发模式的委派工具需要 local-agent 家族的 provider 包与 `@khorsheed/dsh-local-agent-tool-subagent` 同装一个 profile）。

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5`）**：❌ 不可用——`@deepseek-ai/dsh-agent-preset` 行类型在 0.1.5 不存在（0.1.5 的 preset 是 `$DSH_HOME/.agent-presets/` 目录，本包正是来替代它们的）；在 0.1.5 上本包连挂载都谈不上，非 degraded。
- **源码线 / npm 0.1.7-rc.1+**：✅ 完整——行类型随官方 web-app bundle 发布（minHost `0.1.7-rc.1`）。preset 里引用的社区伴生行可用性取决于对应包是否同装（缺则该 preset 带诊断留在名册，其余 preset 不受影响）。

**版本线对照**：`0.1.0` 起要求宿主 `0.1.7-rc.1` 及以后。
