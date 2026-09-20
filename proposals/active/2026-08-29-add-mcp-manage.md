# add MCP：工具与技能里统一管理 MCP server（粘贴解析 + 凭据 + 启停）

- **分类**：plugin
- **状态**：planned
- **最后更新**：2026-08-30
- **官方依赖**：需契约扩展（upstream 候选）——复用 `@deepseek-ai/dsh-mcp-client` 的连接能力；若其无法作为可独立安装的 peer，则退化为目录内建轻量 MCP client。
- **范围**：Phase 2。**Phase 1**（工具 tab 展示）已在进行；本提案在工具 tab 之上加「MCP 服务器 管理」。

> 背景：用户需要「像 skill 一样」在『工具与技能』里统一管理 MCP server——粘贴配置、自动识别 stdio/streamable-http、自动提取凭据（secretRef / 填一次不再明文）、**server 级 + 工具级启停**、单 server 多工具。
> 上一轮结论：**UI 拆开**（每点一次新增一个 server），**本地一份**（目录的 settings namespace，持久化进「打开配置文件」那份 settings 文档）。

## 问题

官方 MCP 靠 `@deepseek-ai/dsh-mcp-client` 每 server 一个 cordis 行（配置在 cordis.yml）；用户无 UI 可加、无启停、密钥明文进配置。目录要提供：粘贴解析、凭据加密、server/工具启停、多工具分组。

## 目标（第一版）

在『工具与技能』的**工具 tab** 里：
1. `新增 Skill` 切到工具 tab 时变成 **`新增 MCP`**。
2. **新增 MCP 对话框**：粘贴一段 MCP server 配置 → **自动解析**（有 `command` → stdio/npx；有 `url` → streamable-http）→ 一张 server 卡（名称、transport、**自动提取的凭据**、enabled 开关默认关）。
3. **保存后**：工具 tab 出现该 MCP server 组（按 server 折叠）。点开看：**① 只读 mcp 配置 JSON**、**② 凭据配置**（类似 skill：可填/可重复粘贴覆盖，保存后不落明文）、**③ 工具列表**（每工具可展开看 schema + **独立启停开关**）。
4. **Store**：MCP 配置存目录 settings namespace；凭据值走 `ctx.credentials`（secretRef）。
5. **启停**：server 级 enabled（default off）。已关闭的 server **置灰展示**（带「已停用」），可重新启用。disabled 不连接、不注入。

## 形态

### 数据（settings namespace）
目录已有 `CAPABILITY_CATALOG_NS`；扩展其 schema 存 `mcpServers`：
```json
[{ "serverName":"amap-maps", "transport":"stdio", "command":"npx", "args":["-y","@amap/amap-maps-mcp-server"], "env":{"AMAP_MAPS_API_KEY":"secretRef:xxx"}, "enabled":false },
 { "serverName":"amap-maps-http", "transport":"streamable-http", "url":"https://mcp.amap.com/mcp?key=<ref>", "enabled":false }]
```
- `enabled` 默认 **false**；密钥值存 credentials，配置只留 `secretRef`。

### 凭据
- 解析时自动探测 env / header / url query 里的占位（如 `AMAP_MAPS_API_KEY`、`?key=`）→ 每条在凭据配置块里给输入框；保存后**不再明文显示**（已配置 → placeholder「已配置——输入新值可替换」），复用 skill 的凭据交互。

### 连接（复用 vs 自建）
- **优先复用** `@deepseek-ai/dsh-mcp-client` 的连接能力（`startConnection`/`Config`）。
- ⚠️ 其是 harness workspace 包（`workspace:*` deps），独立 profile 不可直接装。方案：用**发布版 registry deps** 将其作为目录 peer，或**上游候选**请其暴露「运行时 connect/disconnect + 用户配置读取」。
- **若不可复用**：目录内建**轻量 MCP client**（stdio + streamable-http 的 initialize/tools-list/tools-call），工具经 `ctx.tools` 注册。工作量大但对测试实例立即可用。
- **第一版**：先接管理/持久化/凭据/分组；连接层做成「可复用 mcp-client / 内建 client」的可插拔，先跑通管理与展示，连接随候选逐步落地。

### 单 server 多工具样式（混合）
- 内置/插件工具保持**扁平卡**；**MCP 按 server 折叠**（server 头 = `MCP 徽标 + server 名 + 工具数`）；展开后配置 JSON / 凭据 / 工具列表。
- 工具 tab 的工具计数：内置+插件+（启用的）MCP 工具。

## 决策

- 统一在『工具与技能』管理；`新增 Skill` ⇄ `新增 MCP` 随 tab 切换。
- 一次粘贴**一个** server（粘贴整份 mcpServers 可拆成逐个添加）。
- server 级 + 工具级启停；已停用 server **置灰展示**（可重新启用）。
- 凭据填一次不落明文；可重复粘贴覆盖。
- 风格与设置一致、克制（不用花花绿绿）。

## 待确认 / 风险

- mcp-client 复用：发布版 registry deps vs 内建轻量 client。第一版先做管理与展示，连接层可插拔。
- 是否展示已停用 server（第一版：展示 + 置灰 + 【已停用】，可重新启用）。

## 实现记录

- worktree：`dsh-plugins-wt-tool-display`，分支 `feat/tool-catalog-display`。
- 部署验证：port 3090（cap-catalog-test）目检 + 截图。
