# 变更记录

## 0.2.0-rc.3（2026-10-22）

（版本号说明：家族的 dsh-headless 包 0.2.0-rc.2 版本号已被 npm 发布流水线占用（重复利用被 409 拒绝：「Cannot stage previously published version」——曾发布后被撤回或曾被暂存，外部无法区分，结果相同：该号不可复用）；为守住家族「同一版本线」纪律（check:release-groups），本波家族整体上移 rc.3，内容即 rc.2 计划稿。）

- **BREAKING：OAuth 移除，端点 key 成为唯一认证方式**。注入用 kimi-cli ≥2.1 的原生 `api_key_env`：作用域 `config.toml` 的 managed provider 声明从环境变量读 key，key 只存在于 `<scopedHome>/endpoint-auth.json`（0600）与子进程环境，`config.toml` 无秘密；一把幂等迁移把既有 config 改到该形态（摘 OAuth 子表、替换内联 `api_key`、钉住 `base_url`）。**升级前必须配好 `baseUrl` + `apiKey`**，否则升级后读作未认证（README 带迁移说明）；`credentials/` 与 `oauth/` 残留由 provision 清扫，credential-guard 哨兵随 OAuth 一并删除。
- **设置卡端点凭据表单，并补上「验证端点并获取模型」按钮**：表单与家族其他卡一致（编辑默认 scope 的 endpoint-auth.json）；验证探测已保存端点的 `/v1/models`（kimi 服务没有已确认的无 token 探测，故探测带凭据进行）。
- **「可用模型」有序短名单取代自由文本 model 字段**：与家族其他卡共用同一组件——`<scopedHome>/models.json`，首项即默认模型，端点目录弹窗勾选添加、拖拽排序；`model` 配置键作为回退静默生效。
- **模型目录切换为端点供给**：目录 = 端点 `/v1/models` 实际供应的模型（解析 kimi 自有的 `display_name` / `think_efforts` / `context_length`，兼容纯 OpenAI 形态中转）；命中 managed 模型表的端点 id 以表键为候选值——即 kimi-cli 的可运行名。写名单时自动为尚未建表的列出值补写 `config.toml` 的 managed models 表，让「添加」在同一次写入里变得可运行（手改过的既有表永不被重写）；自由输入随之关闭。
- **设置卡并入「本机 Agent 委派」家族卡**：本包卡读作「本机 Kimi 委派」，作为家族卡的一节呈现；家族卡随后修复为无条件注册——原先的命名空间门控让它在 prod 上永不挂载（2026-10-21）。与旧版家族核混装时回落为独立卡。
- **适配宿主 0.2.1 线**：委派链路迁移到 subagent `startActivation`（宿主 0.2.1 删除旧的 `ctx.subagents.start()`）；加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.1。

## 0.2.0-rc.1（2026-09-30）

- **家族折叠：委派工具收进本包**。新增 `./tool` 组合入口（`src/tool.ts`）——`subagent_kimi` 委派工具由 agent 预设点名 `name: '@khorsheed/dsh-local-agent-kimi/tool'` 按会话授予，Config 两字段（`provider` / `toolName`）全部可选、默认即本包取值，预设行无需配置；行 id `tool-subagent-kimi` 不变。bundle patch 不再插 profile 根工具行，本包自挂载恰好一行（provider 行），插件清单一个 provider 一张卡。实现共享自家族核 `@khorsheed/dsh-local-agent` 的 `./tool-factory` 导出；对 `@khorsheed/dsh-local-agent-tool-subagent` 的依赖移除（该包退役）。

## 0.1.0-rc.8（2026-09-30）

家族同版联动：加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。无功能变更。

## 0.1.0-rc.7（2026-09-27）

家族同版联动：随宿主 0.1.7-rc.2 基线发布波重发，全量构建+测试在 rc.2 基线通过。README 截图整理（会话列表一张从未存在的引用删除，全部图片引用可解析）。无功能变更。

## 0.1.0-rc.6（2026-09-26）

首个公开发布。
