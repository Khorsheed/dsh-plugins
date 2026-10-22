# 变更记录

## 0.2.0-rc.2（2026-10-22）

- **BREAKING：网页登录移除，端点 key 成为唯一认证方式**。部署级凭据为插件配置 `baseUrl` / `apiKey`；每个作用域可再以 `<scopedHome>/endpoint-auth.json`（0600）按字段覆盖——「scope 文件 > profile 配置」。spawn 时注入为自定义 provider 覆盖片段加进程环境变量，`config.toml` 不被改写；key 不带 `baseUrl` 时直连 OpenAI 官方端点。**升级前必须配好端点凭据**，否则升级后读作未认证（README 带迁移说明）；残留的 `auth.json` 由 provision 每次启动清扫，`/codex login` 不再存在。
- **设置卡新增端点凭据表单与「验证端点并获取模型」按钮**：卡片编辑默认 scope 的 endpoint-auth.json；验证探测 `GET <baseUrl>/v1/models`（兼容带不带 `/v1` 后缀的 baseUrl），不可达 / HTTP 状态 / 形状不符各失败形态折进判定文本。
- **「可用模型」有序短名单取代自由文本 model 字段**：与家族其他卡共用同一组件——`<scopedHome>/models.json`，首项即默认模型，端点目录弹窗勾选添加、拖拽排序。`model` 配置键作为回退静默生效（YAML、API 写入），`/codex status` 照报生效设置。
- **模型目录切换为端点供给**：目录 = 端点 `/v1/models` 实际供应的模型，与验证按钮同一次探测；原生 app-server 注册表降级为元数据补全（label / description / 推理档位 / isDefault），端点不供应的注册表项被丢弃。无端点凭据时添加弹窗带原因空载，传输故障保留上次成功清单。
- **设置卡并入「本机 Agent 委派」家族卡**：本包卡读作「本机 Codex 委派」，作为家族卡的一节呈现；家族卡随后修复为无条件注册——原先的命名空间门控让它在 prod 上永不挂载（2026-10-21）。与旧版家族核混装时回落为独立卡。
- **适配宿主 0.2.1 线**：委派链路迁移到 subagent `startActivation`（宿主 0.2.1 删除旧的 `ctx.subagents.start()`）；加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.1。

## 0.2.0-rc.1（2026-09-30）

- **家族折叠：委派工具收进本包**。新增 `./tool` 组合入口（`src/tool.ts`）——`subagent_codex` 委派工具由 agent 预设点名 `name: '@khorsheed/dsh-local-agent-codex/tool'` 按会话授予，Config 两字段（`provider` / `toolName`）全部可选、默认即本包取值，预设行无需配置；行 id `tool-subagent-codex-local` 不变。bundle patch 不再插 profile 根工具行（官方 `tool-subagent-codex` 行的停用覆盖保留），本包自挂载恰好一行（provider 行）。实现共享自家族核 `@khorsheed/dsh-local-agent` 的 `./tool-factory` 导出；对 `@khorsheed/dsh-local-agent-tool-subagent` 的依赖移除（该包退役）。

## 0.1.0-rc.8（2026-09-30）

家族同版联动：加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。无功能变更。

## 0.1.0-rc.7（2026-09-27）

家族同版联动：随宿主 0.1.7-rc.2 基线发布波重发，全量构建+测试在 rc.2 基线通过。README 截图整理（委派视图一张从未存在的引用删除，全部图片引用可解析）。无功能变更。

## 0.1.0-rc.6（2026-09-26）

首个公开发布。
