# 变更记录

## 0.2.0-rc.4（2026-10-24）

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
