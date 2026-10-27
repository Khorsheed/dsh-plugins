# 变更记录

## 0.2.2（2026-10-27）

- **成员的子会话日志始终可读**：写入前有一道保护，不再因为异常写入让整份日志读不出来（仓库另附 `pnpm repair:member-logs` 检查和修复已损坏的日志）。
- **会话列表显示命令行成员的状态**：在干活、已完成、等你回复。
- **成员写在行内代码里的文件路径可以点开**：在右侧栏文件查看器里打开。

## 0.2.1（2026-10-27）

- **修复几个模式套件一起装时设置存不上**：同一个配置里装了多个模式套件时，卡片上的开关和默认模型一改就被拒；现在这些设置存在各 harness 自己的目录里（`card-settings.json`），不再写进配置文件，原来配好的值照常生效。
- **DSH 委派不再需要打开**：DSH 一节的「启用」开关去掉了，装上就能用；委派工具 `subagent_dsh` 只在开发、游戏开发、剪辑模式的会话里出现。
- **常驻模式（live）默认打开**：四家都默认常驻，遇到问题可以在卡片上关掉，改回每次新起一个。
- **卡片头跟着登录状态走**：登录或登出后，卡片头的状态点立刻更新，不再停在红色。
- **读不到登录状态时直说**：显示「读取登录状态失败」，不再给出一个点了没用的「网页登录」。
- **深色模式下「添加模型」的确认按钮看得清了**：改用宿主的主按钮配色，不再白底白字。

## 0.2.0（2026-10-26）

rc.3 之后到正式版的变化（协作间里的 CLI 成员能力为主，详见 room 0.2.3）：

- **CLI 成员能用所在模式的插件工具**：邀请 Codex / Claude Code / Kimi 成员时选了模式，成员就能调用这个模式的插件工具（经成员桥接的 `dsh-member` MCP 服务列出与转发）；工具跑在成员自己的子会话上，模式的面板和插件状态都归这个成员，子会话记下所选模式，别的模式的页签随之隐藏。没有模式或宿主不支持时不多给工具；local-agent 家族自己的委派工具不转给 CLI；刚挂上的模式会等它的工具注册稳定（至多 3 秒）再列出。
- **模式技能装进成员自己的技能目录**：模式带的技能（如剪辑）在每次列工具时写进该 CLI 的技能目录（`<harness home>/skills/dsh-<名>/SKILL.md`），Codex、Claude Code 与 Kimi 都能读到。
- **模式工具的确认在协作间里问**：CLI 成员调用需要确认的模式工具时，确认请求交给协作间，由你点「允许一次 / 拒绝」。
- **CLI 成员能向你提问、向别的会话求助**：成员桥接提供 `ask_user_question`（在协作间里出选项卡，你点选或打字回答）与 `room_help`；Codex / Claude Code 的桥接调用最长可等 30 分钟。
- **成员的实时输出和宿主自己的流式一样**：思考显示成宿主的思考行（一行滚动最新段落、展开看全文），回答直接显示正文，不再在原始文本上套「思考中/正在生成」标签——成员子会话与协作间里一致。
- **修复续跑的成员第二轮报「identity changed: model」**：Claude 成员续跑时绑定的模型与首轮不一致；现在原样沿用首轮绑定的模型。
- **修复 CLI 成员调用模式工具全部失败**：子会话同步与宿主的路由缓冲重复写入，导致工具执行的检查点落盘报「append seq mismatch」；现在先排空缓冲、只补缺的部分，并能自愈。
- **修复重启打断的一轮让成员再也接不上**：宿主在成员一轮中途重启后，日志里那一轮没有收尾，下一轮起头即被判为损坏（Context Lens 也打不开）；重新接上成员时先补上中断收尾。
- **修复 0.1.5 宿主上实时节点的思考图标**：改用包内生成的图标模块。
- **README 重写**：改为大白话说明，完整参考移到 `docs/`。
- **HarnessModelPicker 新增 `fields` 形态**:以带标签的表单下拉框(模型,以及可选的思考强度)呈现,替代下钻菜单,供其它字段都是下拉框的对话框使用(协作间邀请对话框首用)。
- **版本号去掉 rc**:社区包不再发 prerelease 版本(docs/publishing.md「版本号规则」),家族各包同版 0.2.0;本节原记为 0.2.0-rc.4。
- **邀请成员对话框的模型列表与「可用模型」短名单一致**（外部 harness）：邀请时的模型选择器原来显示端点全量可服务目录；现在按 models.json 短名单的范围与顺序给候选（短名单里端点已不再供应的值保留为裸行，与成员对话框同一约定），无短名单时维持目录原样。成员对话框本就按短名单——邀请与成员管理自此同一份候选。

## 0.2.0-rc.3（2026-10-22）

（版本号说明：家族的 dsh-headless 包 0.2.0-rc.2 版本号已被 npm 发布流水线占用（重复利用被 409 拒绝：「Cannot stage previously published version」——曾发布后被撤回或曾被暂存，外部无法区分，结果相同：该号不可复用）；为守住家族「同一版本线」纪律（check:release-groups），本波家族整体上移 rc.3，内容即 rc.2 计划稿。）

适配宿主 0.2.1 线：verifiedHost 前移至 0.2.1-rc.1（host-021 波全量构建+测试对 0.2.1-rc.1 树双绿，并经 3080 生产验收）；`@deepseek-ai/dsh-*` peer 区间加宽覆盖宿主 0.2.1。

- **委派迁移到 0.2.1 的 subagent `startActivation` 通道**：宿主删除了 `ctx.subagents.start()`。全部委派走受管 activation（`delivery: 'caller'`——家族 Remote 仍是唯一结果通道，父模型不会收到第二份完成通知）；取消改接 `activation.dispose()`；provider run id 每次执行全新铸造（与官方 dsh-sdk provider 同约定），child session 身份改走家族 intent 通道。模型面行为不变：同样的 resume 句柄、工具结果文本、Remote 推送与 stop/cancel 结果；宿主生命周期事件（`subagent/start`/`end`）改带 per-execution id，家族无消费者按它 join。
- **家族设置面整合为一张「本机 Agent 委派」卡**：Plugins 页只注册一个 `plugins.item` 条目（order 100），为每家 harness 渲染一个可折叠节——节头带 harness 标签、认证状态点与「未检测到 CLI」标签，节体展开才挂载（与独立卡时代的草稿语义一致）。companion 经 `localAgentUi.registerHarnessCard` 注册自己的节；注册表挂在 cordis 服务上（每个 client bundle 各自内联 core 源码，模块级共享不成立）。混合版本自动降级：旧 companion 配新 core 保留独立卡，新 companion 配旧 core 照旧注册独立卡。卡片需要宿主 0.1.7-alpha.1+（Plugins 页 `plugins.item` 席位），更旧的宿主不渲染也不报错。
- **修复家族卡在生产环境永不挂载**：卡片原先照搬 companion 惯例门控在 `configForms.whileServed(['local-agent'])`，而宿主 describe 只收录带 volatile 配置字段的命名空间、core 的 Config 没有 volatile 字段——门控从不触发，companion 又已放弃各自的独立卡席位，Plugins 页一张 local-agent 卡都不剩（3080 实证，2026-10-21）。改为无条件注册：client bundle 只在 core 行进入组合时加载，bundle 在场本身就是安装层门控；core 服务端缺席时卡片仍渲染，各节按家族惯例呈现降级态。
- **端点凭据改走两个无会话 gateway Remote**：新增 `endpointAuth`（读解析后状态，密钥以布尔返回）与 `configureEndpoint`（按字段 set/clear/不动），卡片凭据表单改写默认 scope 的 `endpoint-auth.json`（0600，文件名命中评测契约哈希的凭据拒绝名单）。原 volatile 行配置通道在生产宿主上写入被拒且客户端拿不到原因（cordis.patch.yml 的 mtime 证明没有任何一次卡片写入落盘），一旦成功还会把 key 明文写进 profile patch；设置层的端点字段随之撤回，profile 行保持部署级回落。对不带这两个 Remote 的旧 core，卡片显示不可用提示。
- **「可用模型」分节成为家族共享实现**：新增 `src/model-list.ts`（harness 中立的 `models.json` 读写助手，从包根导出）与 client 组件 `ModelListSection`（外壳、拖拽排序行、端点目录添加弹窗与自带状态，文案在 core 词典 `models.*`）；claude-code 的精选名单交互提升为家族唯一实现，codex/kimi/claude-code 三张卡同源渲染，配套的 `modelList`/`modelDirectory` gateway 面随本波落地。各成员卡面的具体变化见各自 CHANGELOG。
- **打包层**：声明 `engines.dsh`（`>=0.1.5-rc.1 <0.3.0-0`——声明即独占兼容裁决，上限让未验证的宿主线在安装期 fail-closed）；invariant 伴随件随官方 0.2.1 整包删除 invariants 体系而退役（boot 期 harness 契约审计是记录在案的接受损失，失败模式退回既有降级路径）。

## 0.2.0-rc.1（2026-09-30）

- **家族折叠：委派工具工厂收进本包**。新增 `./tool-factory` 导出（`mountSubagentDelegationTool` / `subagentToolConfigSchema` / `SubagentToolConfig` / `RESUME_HINT_PREFIX`）——原共享包 `@khorsheed/dsh-local-agent-tool-subagent` 的实现整体迁入，该包随之退役。各 provider 的委派工具改为各自包内的 `./tool` 组合入口（`@khorsheed/dsh-local-agent-kimi/tool` 等），由 agent 预设点名按会话授予，不再挂 profile 根；工具来源标签的 owner 由调用入口传自己包名，工厂不再硬编码。随工厂迁入新增 peer 依赖 `@deepseek-ai/dsh-tools`。

## 0.1.0-rc.8（2026-09-30）

家族同版联动：加宽 `@deepseek-ai/dsh-*` peer 区间以覆盖宿主 0.2.0（0.2.0 的兼容闸会禁用 peer 区间不覆盖宿主版本的已装插件）。无功能变更。

## 0.1.0-rc.7（2026-09-27）

家族同版联动：随宿主 0.1.7-rc.2 基线发布波重发，全量构建+测试在 rc.2 基线通过（rc.1→rc.2 无触及本家族的宿主变更，逐类清点见 [Agent Note](../../.agents/notes/implemented/architecture/2026-09-27-host-017-rc2-breaking-changes.md)）。README 按仓标准补齐双语。无功能变更。

## 0.1.0-rc.6（2026-09-26）

首个公开发布（local-agent 家族七包同版首发：core → tool-subagent / dsh-headless → kimi / codex / claude-code / dsh）。
