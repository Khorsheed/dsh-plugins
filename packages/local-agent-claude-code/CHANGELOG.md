# 变更记录
## 0.2.0（2026-10-26）

rc.3 之后到正式版的变化：

- **一次 API 调用就是一条请求、用量只算一次**：Claude 对一条消息的每个内容块各发一个事件并重复带同一份用量，子会话镜像原来把一次调用拆成好几条、每条都显示同样的数字；现在按消息 id 合成一步，用量挂在这次调用的最后一行，且每次调用都带自己的用量（原来只有整轮最后一条有）。live 路等调用结束（`message_delta`）后才落盘，用最终用量，跨工具结果的调用也不再重复计数。Context Lens 里每次请求的 token 因此准确。
- **修复工具发现循环在子会话里显示不全**：`ToolSearch` 的结果原来接不上，收尾时多出一个假的「已中断」占位，整轮写入还挤在结尾一次落盘；现在如实折叠。
- **修复子会话步骤乱序、重启后被判损坏**：live 镜像改为写入时才编号、一次只开一个步骤，先开始的先落盘。
- **修复取消后日志不可读**：取消后迟到的 CLI 中断提示不再写到这一轮结束之后。
- CLI 注入的文本（技能正文、命令输出）不再被当成回答镜像出来。
- 协作间的桥接调用最长可等 30 分钟（`MCP_TOOL_TIMEOUT`），供成员等你回答问题。
- **README 重写**：改为大白话说明，完整参考移到 `docs/`。
- **版本号去掉 rc**:社区包不再发 prerelease 版本(docs/publishing.md「版本号规则」),家族各包同版 0.2.0;本节原记为 0.2.0-rc.4。
- **缓存命中 0 与未上报可区分**：用量带任一缓存字段时 `cacheReadTokens` 恒写（读到 0 就写 0)——读日志的一方（Context Lens）不再分不清「命中 0」与「没上报」。
- **子会话日志写入 `request/header`**：子会话的配置事实（模型 + 推理强度）原来无处记录，Context Lens 整卡「未记录」。现在每轮写入宿主原生 `request/header`（只在变化时记录）——exec 路用 init 事件的观测 model（回退到启动参数）,live 路用会话配置；claude 的 wire 从不携带 effort,provider 自己设置的 env 参数即权威来源。
- **修复成员推理强度整体不可用**：端点目录的 effort 解析只读模型条目的顶层 `effort` 字段，而端点把它嵌在 `capabilities.effort` 下（openproxy 中继 2026-10-22 实测形状；官方 API 同形）——目录条目自此重新带上推理档位，成员对话框的推理强度恢复可选（两个字段位置都认，顶层优先）。
- **成员会话的模型对话框与「可用模型」短名单严格一致**：成员的模型目录原来会混入配置与历史附加项，与卡片短名单不一致。现在成员对话框的候选即短名单（按名单顺序），名单外只保留成员当前绑定的模型（避免既有绑定显示空白）；卡片的添加对话框只列端点真实供应的模型，配置/历史附加项不再混入。

## 0.2.0-rc.3（2026-10-22）

（版本号说明：家族的 dsh-headless 包 0.2.0-rc.2 版本号已被 npm 发布流水线占用（重复利用被 409 拒绝：「Cannot stage previously published version」——曾发布后被撤回或曾被暂存，外部无法区分，结果相同：该号不可复用）；为守住家族「同一版本线」纪律（check:release-groups），本波家族整体上移 rc.3，内容即 rc.2 计划稿。）

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
