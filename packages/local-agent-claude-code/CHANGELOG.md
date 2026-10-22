# 变更记录

## 0.2.0-rc.3（2026-10-22）

（版本号说明：家族的 dsh-headless 包 0.2.0-rc.2 曾被发布后又撤回，npm 永久烧掉该版本号；为守住家族「同一版本线」纪律（check:release-groups），本波家族整体上移 rc.3，内容即 rc.2 计划稿。）

- **BREAKING：OAuth 网页授权整体移除，端点凭据成为唯一认证方式**。部署级凭据为插件配置 `baseUrl` / `apiKey` / `authToken` 三元组（`apiKey` 以 `ANTHROPIC_API_KEY`、`authToken` 以 `ANTHROPIC_AUTH_TOKEN` 发出，中转的两种认法都兼容）；每个作用域可再以 `<作用域目录>/endpoint-auth.json`（0600）按字段覆盖——优先级就是「scope 文件 > profile 配置」。**升级前必须配好端点凭据**，否则升级后读作未认证（README 带迁移说明）；官方订阅（Pro/Max）的 OAuth 路径随之消失，失效 OAuth 残留由 provision 启动时清扫，换 key 下一轮生效、无需重载。
- **设置卡新增端点凭据表单与「验证端点并获取模型」按钮**：卡片编辑的正是默认 scope 的 endpoint-auth.json；验证即带解析出的凭据探测 `GET <baseUrl>/v1/models`，保存成功翻转认证状态点。凭据等级语义不变：key 在场读 present-unverified，跑通一轮升 verified，一轮 401 打 rejected，重写凭据文件即恢复手势。
- **「可用模型」有序短名单取代默认模型字段**：持久化为 `<作用域目录>/models.json`，首项即默认模型；添加弹窗的候选全部来自端点当前供应的目录（勾选添加、拖拽排序），任何本地残留别名都混不进选择器。名单为空时完整回退既有链；成员的模型在首轮即绑定，改名单只影响新成员，不会换掉对话中的成员。
- **模型目录改为端点供给**：目录 = 所配端点实际供应的模型（探测预算 20 秒，传输错误保留上次成功数据）——本地 CLI 的词汇表不再给一把失效 key 打掩护。
- **设置卡并入「本机 Agent 委派」家族卡**：Plugins 页的 per-harness 卡折叠为一张家族卡、按 harness 分节呈现，本包卡读作「本机 Claude Code 委派」；家族卡随后修复为无条件注册——原先的命名空间门控让它在 prod 上永不挂载（2026-10-21）。与旧版家族核混装时回落为独立卡。
- **适配宿主 0.2.1 线**：委派链路迁移到 subagent `startActivation`（宿主 0.2.1 删除旧的 `ctx.subagents.start()`）；加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.1。

## 0.2.0-rc.1（2026-09-30）

- **家族折叠：委派工具收进本包**。新增 `./tool` 组合入口（`src/tool.ts`）——`subagent_claude_code` 委派工具由 agent 预设点名 `name: '@khorsheed/dsh-local-agent-claude-code/tool'` 按会话授予，Config 两字段（`provider` / `toolName`）全部可选、默认即本包取值，预设行无需配置；行 id `tool-subagent-claude-code-local` 不变。bundle patch 不再插 profile 根工具行（官方 `tool-subagent-claude-code` 行的停用覆盖保留），本包自挂载恰好一行（provider 行）。实现共享自家族核 `@khorsheed/dsh-local-agent` 的 `./tool-factory` 导出；对 `@khorsheed/dsh-local-agent-tool-subagent` 的依赖移除（该包退役）。

## 0.1.0-rc.8（2026-09-30）

家族同版联动：加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。无功能变更。

## 0.1.0-rc.7（2026-09-27）

家族同版联动：随宿主 0.1.7-rc.2 基线发布波重发，全量构建+测试在 rc.2 基线通过。README 按仓标准补齐双语。无功能变更。

## 0.1.0-rc.6（2026-09-26）

首个公开发布。
