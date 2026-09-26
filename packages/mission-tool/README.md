# @khorsheed/dsh-mission-tool

[English](README.en.md) | 中文

`@khorsheed/dsh-mission` 的伴生工具行：模型可见的 12 个 `mission_*` 工具与 `tool:mission` 提示词段，**按会话授予**——只出现在引用了它的 agent preset 组合的会话里。`/mission` slash 的注册自 preset 可见性收口（A3）起也归本行（落进 preset scope 层，handler 与定义留在 core）；服务面、CLI 与任务 tab 留在 core；这一行只进 preset，不进 profile 根。单实例多模式（提案 2026-08-26）工具行解耦的第三对（M4'③）。

## 形态：不自挂载的伴生包

- **只注册工具，不发布服务**（`ctx.provide` 为零）——preset 挂载面的 isolate-realm 规则只拒服务行，工具行可裸放 preset（官方 `tool-bash` 行同构）。
- **不声明 `dsh.bundle`**：作为依赖安装只让模块可解析（plain dependency，同 `@khorsheed/dsh-local-agent-dsh-headless` 先例），不会自动挂到任何组合。授予入口是 preset 的 `agent.cordis.yml` 按名引用：

  ```yaml
  - id: mission-tool
    name: '@khorsheed/dsh-mission-tool'
    config:
      tools: read          # 可选；缺省 all
  ```

- **运行依赖 core 的全局服务**：core 服务声明为 `inject = ['mission']`（同族 companion 例外，见 `scripts/check-plugin-independence.ts` 的 COMMUNITY_SERVICE_INJECTORS）——preset 的 standing scope 在注册表激活时挂载，早于 profile 靠后 bundle 行提供 core，apply 时一次性 `ctx.get` 探测看到 ABSENT 后没有任何东西会重跑该行（rc.1 挂载序；2026-09-27 3080 生产实证），声明式 inject 让该行 pending 到 core 提供再 apply。core（`@khorsheed/dsh-mission`）未挂载时该行保持 pending（注册表审计显示 `waiting for mission`；不炸 preset 挂载，该 preset 组合照常挂上、不报错，只是模型看不到这些工具），core 出现后行激活、工具与提示词段注册生效；行内 `ctx.get('mission')` 守卫保留为防御性直调路径。工具注册走 `ctx.inject(['tools'])` 延迟注入（挂载序竞态的历史教训），无 tools 注册表的组合同样安全。
- 工具定义工厂由 core 的 `./tool` 子路径导出（`@khorsheed/dsh-mission/tool` 的 `missionToolDefinitions(service, tier)`），业务实现零复制；origin tag 的 owner 是本包（挂在哪个包名下就归因到哪个包）。

**配置**（可选）：`tools` 决定这一行授予哪一组工具。分组是从 core 搬来的：core 不再注册任何模型工具，也不再贡献提示词段。

| `tools` | 注册的工具 |
|---|---|
| `all`（缺省） | 全部 12 个 `mission_*` 工具 |
| `read` | `mission_run_list` / `mission_run_status` / `mission_list` / `mission_get` |
| `none` | 无——连 `tool:mission` 提示词段也不贡献 |

## 安装

```sh
# core 仍按原样全局安装（服务面 / CLI / slash / 任务 tab 都在 core）
dsh plugin --profile web add @khorsheed/dsh-mission
# 伴生包只需装到 profile 的 node_modules（可解析即可，不会自挂载）
dsh plugin --profile web add @khorsheed/dsh-mission-tool
# 然后在目标 preset 的 agent.cordis.yml 加上面那行
```

web-dev 场景包的开发模式 preset（`profiles/web-dev/presets/dev`）已带此行（缺省 `all`）；评测包的 `eval` 预设（`profiles/web-eval`）以 `tools: read` 引用它——同一 profile 里其它预设的会话一个都拿不到。

## Compatibility

- **npm 发布线（`@deepseek-ai/dsh@0.1.5-rc.1`）**：✅ 完整——工具注册进宿主 tools 注册表并贡献提示词段；0.1.5 官方插件列表的「会话插件」组按 preset 组合呈现本行（短名标题、状态徽标、活挂载相位点）。core 缺席时组合照常挂载，该行保持 pending（注册表审计显示 `waiting for mission`），core 出现后行激活并注册工具。
- **源码线（deepseek-harness master）**：✅（verifiedHost: 0.1.5-rc.1）。
- 低于 0.1.5 的宿主：preset 组合与工具行机制在更早的线上已存在，但「会话插件」清单视图是 0.1.5 的呈现——与 worktrees-tool / room-tool 两条伴生行同一档，minHost 钉 0.1.5-rc.1。
- **发布顺序**：引用伴生行的 pack 必须先有伴生包被发布 / 安装；行解析失败会让该 preset 组合报 broken（实例 boot 不受影响），不是静默降级。

**版本线对照**：`0.1.0` 起支持宿主 `0.1.5-rc.1` 及以后。
