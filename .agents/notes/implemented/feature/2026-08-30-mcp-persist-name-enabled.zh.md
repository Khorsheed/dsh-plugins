# Agent Note: MCP 设置只持久化工具 name+enabled；描述在启动时重新发现

Status: implemented

[English](2026-08-30-mcp-persist-name-enabled.md) | 中文

本笔记记录 `@khorsheed/dsh-capability-catalog` 0.1.73 中落地在 `settings.yaml` 的 `capability-catalog.mcp` 块的 MCP 持久化决策。

## 问题

持久化的 MCP 块原先把每个已发现工具的完整 `description` 和整套 `parameters` JSON schema 连同 `name`、`enabled` 一起落盘。对 `mcp-server-everything`（13 个工具）就是约 200 行 / ~8KB（占整个 8KB 配置文件），对含几十上百个工具、schema 很大的真实 server 更糟。工具描述与参数 schema 是**连接时从 server 发现**的，不是用户配置；把它们持久化既撑爆配置文件，又在 server 变动后过期。

## 决策

**settings 块只持久化每个工具的用户开关选择——`{ name, enabled }`，绝不存 `description` 或 `parameters`。** 完整元数据通过启动时重连已启用 server 来重新推导：

- `McpStore.toPersisted()` 把每个工具缩减为 `{ name, enabled }`。
- `McpStore.loadFrom()` 以空描述重建工具，然后**按名合并**持久化的开关到既有内存工具上（保留其已发现的 `description`/`parameters`）。这一点至关重要：`discover()` 在内存里填好描述，`persist()` 会经过 settings `watch` 往返，`loadFrom` 不能把发现刚产出的描述冲掉。
- `McpStore.reconnectAll()` 启动时重连每个已启用 server（异步、单 server 错误内聚）以重新填描述/参数；服务在 settings 注入加载持久化状态后调用它，并在完成后重新同步 `ctx.tools` 注册。
- `discover()` 保留用户逐工具的启用开关（重新发现只刷新 schema、不重置开关；新工具默认启用）。

## 备选方案

- **保留完整工具列表持久化。** 已否决：撑爆 settings.yaml 且过期。这是诊断出的根因（13 个工具把文件推到 8401 字节 / 203 行）。
- **只持久化 `{ name, enabled }` 且从不重新发现。** 否决为首选（即我们放弃的 B 方案）：描述/参数会一直为空，直到用户手动 discover，拖累模型可调用注册。
- **在 settings.yaml 之外另设元数据缓存文件（desc/params）。** 未采用：启动时重新发现更简单且自愈——缓存同样需要失效处理，而且连不上的 server 本来就提供不了工具。

## 影响

- `settings.yaml` 大幅缩减：实测 8401 → 1688 字节、203 → 39 行、28 → 0 个 `description:` 行（13 个工具的演示 server）。
- 工具 `description`/`parameters` 只在连接/发现后存在于内存。启动时会对已启用 server 重新连接（spawn 每个 stdio/HTTP 客户端）以重新填充；连不上的 server 只留工具名（并记录错误），直到可连接为止。
- 逐工具启用开关跨重启保留；重新发现从不重置用户开关。
- `loadFrom` 的合并是承重细节：没有它，发现后的写→watch→重载往返会刚填好描述又被冲掉。
