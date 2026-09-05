# Agent Note: dsh-eval 离线动词——dataseek 契约、校验器与哈希内核

Status: implemented

## Problem

web-eval 的 I1 手工走通一格，留下两份没人能校验的契约示例——一个 condition、一个 plan（题库仓库 i1-walk 分支）。编排器 `@khorsheed/dsh-eval` 不存在，契约漂移（permission 词表、judge/expectedNs 一致性、lock 解析）与条件身份（「这两格只差一个因子」必须可证明）都没有执行者。数据集作者协议也没有评测契约的位置，schema 形状只活在题库仓库的零散文件里。

## Decision

`packages/eval`（`@khorsheed/dsh-eval`）交付编排器的离线一半：

- 三份契约 schema（`dataseek.condition/1`、`dataseek.plan/1`、`dataseek.verdict/1`）加一条 `dataseek.condition-lock/1` 记录，集中在 `src/schema.ts` 一个模块，并逐字发布进数据集作者协议 §6。测试钉住文档与代码互不漂移，协议里的 JSON 示例直接当校验器夹具。
- 手写 JSON Schema 子集校验器逐关键字镜像 `mission/src/schema.ts`——刻意复制而非 import，因为社区插件绝不 import 兄弟 `@khorsheed/*` 包。阶段 schema 出子集即 error：mission 的 schema-check 守卫运行时消费同一批文件，两个校验器分叉会让 validate 承诺守卫拒绝的东西。
- `validatePlan` 校验 plan schema 与语义（judge 在场但为空合法；judge 缺省时 `expectedNs` 不得含 `llm-draft`；判官不得是选手；数值下限），把条件 id 对着 `conditions/<id>.lock.json` 解析（缺 lock = 「未就绪」warning，绝不是 error），校验被引用的条件文档（四个可空字段的 `null` = 「未解析」warning），并 lint 阶段 schema。
- 条件哈希 = 规范化 JSON（键排序、无空白）的 sha256，`notes` 不参与——改注释不得读作新因子。scoped home 哈希只覆盖拒绝清单之外、配置类后缀的文件（auth/env 文件、token/key/credential/secret/password/auth 名字、credentials/oauth/sessions/keys/secrets 目录、符号链接、超大文件）；内容只进摘要，绝不离开。
- 服务面 `ctx.eval`（`validatePlan` / `hashCondition` / `hashHome`）与 `dsh-eval` CLI（`validate`、`conditions hash`；退出码 0/1/2 同 lab，数据走 stdout、诊断走 stderr）。无 config、无 inject、无 `@khorsheed/*` import、无 client 半；CLI 直连内核，脚本场景与挂载插件行为一致。

I1 的字段决定按原文编码：plan 的 conditions 写 id 不写 sha；sha 由 lock 解析；未解析 ≠ 非法。

## Alternatives considered

- **用 ajv 做校验。** 否决：mission 的守卫已为阶段 schema 定义了子集；第二个更强的校验器会让 validate 接受守卫拒绝的 schema。零依赖让两者在构造上对齐。
- **import mission 的校验器。** 否决：社区插件绝不 import 兄弟 `@khorsheed/*` 包（独立性问题器强制）。复制通过镜像完全一致的关键字集并在模块头声明约束来钉住。
- **条件哈希把 `notes` 算进去。** 否决：改注释会铸出新条件哈希、制造幻影因子变化；`notes` 声明为非语义字段。
- **缺 lock 与未解析字段算 error。** 否决：validate 是规划期报告者；拦截归 run 前的就绪检查（I2），后者依赖「畸形（error）」与「尚未解析（warning）」的区分保持有意义。
- **permissions 只在 schema 层给每 harness 枚举。** 考虑过按 harness 条件化的 schema——子集做不到；改为 schema 枚举携带并集、校验器对已知 harness 收窄、对未知 harness 降级为并集检查。

## Consequences

- I1 示例如今只带 warning 即通过校验，条件哈希是确定性的——I1 的验收判据（「plan 过校验且两次哈希相同」）有了工具。
- lock 格式已定但还没有写入者（provision 是 I4）；在此之前所有 plan 都报 `LOCK_MISSING`，这正是走通格的诚实状态。
- schema 演化走协议修订：condition/plan 的新字段以「协议修订中新增可选字段」落地，绝不以未声明键出现（`additionalProperties: false` 全覆盖）。
- run / readiness / generateTemplate / provision 仍未实现；`ctx.eval` 在 I2 扩展它们而不破坏离线面。report 动词已由独立笔记接管：[eval-report-verb](2026-09-05-eval-report-verb.zh.md)。题库侧 manifest `output_schema`（改为按名引用 `schemas/<stage>.json`）的迁移已写进协议，属题库侧后续工作。
