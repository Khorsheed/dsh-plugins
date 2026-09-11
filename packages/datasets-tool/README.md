# @khorsheed/dsh-datasets-tool

[English](README.en.md) | 中文

`@khorsheed/dsh-datasets` 的伴生工具行：模型可见的 8 个 `datasets_*` 工具与 `datasets:tools` 提示词段，**按会话授予**——只出现在引用了它的 agent preset 组合的会话里。服务（`ctx.datasets`）、CLI、`/datasets` slash 与数据集 tab 都留在 core；这一行只进 preset，不进 profile 根。单实例多模式（提案 2026-08-26）工具行解耦的第三对（M4'③）。

## 形态：不自挂载的伴生包

- **只注册工具，不发布服务**（`ctx.provide` 为零）——preset 挂载面的 isolate-realm 规则只拒服务行，工具行可裸放 preset（官方 `tool-bash` 行同构）。
- **不声明 `dsh.bundle`**：作为依赖安装只让模块可解析（plain dependency，同 `@khorsheed/dsh-local-agent-dsh-headless` 先例），不会自动挂到任何组合。授予入口是 preset 的 `agent.cordis.yml` 按名引用：

  ```yaml
  - id: datasets-tool
    name: '@khorsheed/dsh-datasets-tool'
    config:
      tools: authoring     # 可选；缺省 all
  ```

- **运行依赖 core 的全局服务**：apply 时 `ctx.get('datasets')` 探测——core（`@khorsheed/dsh-datasets`）未挂载则**静默跳过注册**并留一行日志（degrade：不炸 preset 挂载，该 preset 组合照常挂上，只是模型看不到这些工具）；工具注册走 `ctx.inject(['tools'])` 延迟注入（挂载序竞态的历史教训），无 tools 注册表的组合同样安全。
- 工具定义工厂由 core 的 `./tool` 子路径导出（`@khorsheed/dsh-datasets/tool` 的 `datasetToolDefinitions(service, options)`），业务实现零复制；origin tag 的 owner 是本包（挂在哪个包名下就归因到哪个包）。

**配置**（可选）：`tools` 决定这一行授予哪一组工具。分组是从 core 搬来的：core 不再注册任何模型工具，也不再贡献提示词段。

| `tools` | 注册的工具 |
|---|---|
| `read` | 六个读类动词：`datasets_list` / `datasets_show` / `datasets_describe` / `datasets_read` / `datasets_snapshot` / `datasets_validate` |
| `authoring` | read + `datasets_put_item`（起草进工作树；`git commit` 仍是人的） |
| `all`（缺省） | authoring + `datasets_worktree_path`（整层物化的托管 worktree） |
| `none` | 无——连 `datasets:tools` 提示词段也不贡献 |

四档是一条包含链；**评测域建议 `authoring`**：规划期 agent 要读题、要出题，整层物化是编排器的动作。

## 安装

```sh
# core 仍按原样全局安装（服务 / CLI / slash / 数据集 tab 都在 core）
dsh plugin --profile web add @khorsheed/dsh-datasets
# 伴生包只需装到 profile 的 node_modules（可解析即可，不会自挂载）
dsh plugin --profile web add @khorsheed/dsh-datasets-tool
# 然后在目标 preset 的 agent.cordis.yml 加上面那行
```

web-dev 场景包的开发模式 preset（`profiles/web-dev/presets/dev`）已带此行（缺省 `all`）；评测包的 `eval` 预设（`profiles/web-eval`）以 `tools: authoring` 引用它——同一 profile 里其它预设的会话一个都拿不到。

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）**：✅ 完整——工具注册进宿主 tools 注册表并贡献提示词段；0.1.5 官方插件列表的「会话插件」组按 preset 组合呈现本行（短名标题、状态徽标、活挂载相位点）。core 缺席时行照常挂载，只是不注册工具（记一行日志）。
- **源码线（deepseek-harness master）**：✅（verifiedHost: 0.1.5-rc.1）。
- 低于 0.1.5 的宿主：preset 组合与工具行机制在更早的线上已存在，但「会话插件」清单视图是 0.1.5 的呈现——与 worktrees-tool / room-tool 两条伴生行同一档，minHost 钉 0.1.5-rc.1。
- **发布顺序**：引用伴生行的 pack 必须先有伴生包被发布 / 安装；行解析失败会让该 preset 组合报 broken（实例 boot 不受影响），不是静默降级。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。
