# Agent Note：技能环境提示的退役 source 外壳在 rc.1 上会杀掉整个回合（已改为生产者自持 kind）

Status: implemented

## 问题

`packages/capability-catalog/src/envHint.ts` 在 `skill` 工具的 `tools/post-execute` 上给模型追加一条按技能的凭证映射提示（`additionalContexts` 用户消息）。它的 source 用的是 0.1.5 时代外壳 `{kind: 'plugin', plugin: 'capability-catalog'}`——因为 `additionalContexts` 的非官方形状必须经 `as unknown as never` 强转，这道强转让它逃过了 rc.1 波所有以 `createUserMessage` 为线索的排查。

rc.1 的会话格式 v4 准入（持久层 `encodeEvent` 里的 `assertV4SourceRowAdmission`）拒绝 source.kind 缺失、为空、或恰好等于 `'plugin'` 的消息——后者正是退役外壳。拒绝在回合的 append 内部抛出，agent 循环把它拍平成 `UNKNOWN`，回合死亡，日志最后一行停在 `tool/call`（失败的那次 append 永不落盘）。3093 上确定性复现：凡模型加载了带有「已配置凭证 env 声明」的技能（该实例上的 `dsh-self-restart-guard`）的回合必炸；普通回合正常——所以这一波此前纯 UI 的验收完全没踩到。

## 决策

注入改盖生产者自持 kind，沿 ankh-guard 先例：`{kind: 'capability-catalog', plugin: 'capability-catalog', form: 'env-hint'}`。自持 kind 在两条宿主线上都合法（pre-V4 宿主不校验、逐字节透传；v4 只拒裸 `'plugin'`)，无需探测、无需双臂。

## 备选方案

**kind 用 `plugin:capability-catalog`(v3 迁移的规范形)**。否决：迁移把旧外壳映射成这个形状是为了让**读取侧**认得历史；生产者原生写入就用自己的裸名（ankh-guard、message-tools 的 `kind: 'message-tools'`）。新写入继续带 `plugin:` 前缀等于把退役外壳的词表供起来。跨两个时代的读取侧（message-tools 的 `isMessageToolsSource`）本来就裸名与前缀都认。

**kind 既然已承载身份，把 `plugin` 字段删了**。否决：它是零成本的元数据，老读取方正按它匹配；删掉没有收益，还可能砸按 `plugin === 'capability-catalog'` 匹配的消费者。

**探测宿主线，0.1.5 上保留旧外壳**。否决：自持 kind 两条线都合法，探测纯属仪式。

## 后果

带凭证技能加载不再杀回合；0.1.5 行为不变。真正的教训在排查面：任何藏在 `as never` 强转后的消息写入都会逃出按构造函数的清查——退役外壳的清查必须 grep 字面量 `kind: 'plugin'`，而不是构造点。全仓现在该字面量只剩刻意的测试 fixture 与 message-tools 的读取侧（旧日志识别必须保留）。

## 测试

`tests/env-hint.spec.ts`（新增 3 例）：accept 决策的注入上下文带 `kind: 'capability-catalog'`；无已配置凭证时原样透传；非 skill 执行忽略。包套件 235 绿。

## 相关

- [capability-catalog 经租约面解析 rc.1 preset 作用域](./2026-09-24-capability-catalog-rc1-leased-scope.md)——同包同日修的另一条 rc.1 接缝。
- [社区 agent 预设以声明式 bundle 发布（host 0.1.7-rc.1)](../../implemented/feature/2026-09-24-community-presets-declarative-bundle.md)——漏掉这处强转写入的那一波。
