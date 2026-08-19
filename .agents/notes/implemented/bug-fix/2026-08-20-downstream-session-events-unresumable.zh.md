# Agent Note: 下游 session 事件不可重建——datasets 绑定迁出会话日志

Status: implemented

[English](2026-08-20-downstream-session-events-unresumable.md) | 中文

## Problem

rc.8 web profile 活实例冒烟：任何绑定过数据集的会话在重启后拒绝恢复——`SessionFormatUnsupportedError: session contains event type "datasets/binding" unknown to this harness and not marked ignorable`。[M1](2026-08-19-datasets-store-m1.md) 把会话绑定存为 log-only `datasets/binding` session 事件，沿用仓内 `goal/change` 先例。拒绝是 by design：持久化读路径拒绝解释含有本构建词汇表之外事件类型的日志，因为静默跳过必需事件可能重建出错误的会话。

## Decision

绑定迁出会话日志，落入插件自管的持久化存储：每会话一条带版本的 JSON 记录，位于 `<stateRoot>/bindings/<编码后会话 id>.json`（`$DSH_HOME/state/datasets`，否则 `<cwd>/.dsh-datasets`），原子写入（tmp + rename），解绑即删除，每次调用现读（`src/binding.ts`；`BindingSession` 收窄为 `{ id }`）。CLI 的 `bind`/`unbind`/`binding` 动词经 `--state-root` 写同一存储；`src/session-log.ts`（离线 JSONL/zstd 追加机制及其存活会话竞争）整体删除。datasets 不再有任何调用 `Session.append` 的代码路径；回归测试用一个 `append` 即抛错的假会话驱动绑定动词。

为什么bug表象所暗示的标记修复在下游不可实现（对照 rc.8 checkout 查证）：`KNOWN_SESSION_EVENT_TYPES`（`packages/core/session/src/known-event-types.ts`）只从仓内声明生成——下游插件的 declaration merge 永远进不去，文件头部明确把注册面 deferred「until such a consumer exists」。而 `Session.append(type, data)` 构造的 envelope 是 `{type, seq, time, data}`，非 surface 事件没有 ignorable 通道；整个 harness 没有任何 live 写入方产出 `ignorable: true`（只有持久化打包器 round-trip 该字段、seed 校验器容忍它）。因此社区插件的自定义 session 事件**按构造**不可重建，无论怎么写。`goal/change` 先例从未成立：goal 是仓内插件，它的类型在生成集合里。

推广的教训：**在上游交付注册面之前，下游插件一律不得追加自定义类型 session 事件**；按会话持久化的状态应放插件自己的 `$DSH_HOME/state/<plugin>/` 存储。若某插件的语义确实需要会话日志（审计、fork 继承），那是上游变更请求，不是本地绕行能解决的。

## Alternatives considered

- **两条写入路径都加 `ignorable: true`**（直觉修复）——否决，下游不可实现：CLI 离线追加拥有自己的 envelope 字节，但存活路径走 `Session.append()`，没有标记通道。半个修复仍会让每个经 tab/slash 绑定的会话在重启时毒化。
- **apply 时运行时 `KNOWN_SESSION_EVENT_TYPES.add('datasets/binding')`**——否决：从插件篡改宿主的生成结构；且当 app 把 dsh-session 打包进自己的产物时静默失效（插件的修改落在另一个模块实例上，毒化依旧）。
- **绑定仅留内存（重启即失）**——否决：提案验收要求绑定跨重启存活；存储满足，内存 map 不满足。
- **保留 session 事件作审计、存储作持久副本**——否决：事件即毒源，为审计而写照样破坏恢复。绑定变更的审计移到存储文件本身。

## Consequences

- 绑定过的会话可恢复。CLI `bind` 对存活会话变为安全（每次调用现读——M1 的序号竞争及其安全注记一并消失），约 200 行 zstd 帧手术离开本包。
- 放弃：绑定在会话日志中的席位——不再随会话导出/fork 传递（fork 出的会话以未绑定开始），日志中不再可审计；删除会话留下孤儿记录。三者均已录入 README 的 Known Limitations。
- CLI 界面变化：`--sessions-root` 更名 `--state-root`；预发布线，不留别名。
- 上游跟进项（不由本仓修补）：下游事件类型注册面，或 `Session.append` 的 `ignorable` 通道，会让 session 事件设计重新合法；存储设计无论如何都成立。
- M1 note 的会话绑定条目由本 note 取代；M2 note 的「bind/unbind 写同一 session 事件」事实由本 note 更正。

## Testing

`packages/datasets/tests/`——9 个文件 54 测试全绿。绑定相关覆盖：存储写/读/覆盖/解绑往返、服务重建后的持久化（重启模拟）、损坏或未知版本记录的 fail-loud、id 路径安全编码、CLI 动词对 `--state-root` 的往返、以及不写 session 事件的回归闸（`append` 即抛错的假会话）。

## Cross-references

- [datasets store M1](2026-08-19-datasets-store-m1.md)——session 事件设计的落地处（被取代条目指向本 note）。
- [datasets M2](2026-08-19-datasets-m2-remote-tab.md)——Remote/tab 面的绑定动词随其余路径一并迁入存储。
- [datasets 提案](../../../proposals/active/2026-08-19-datasets-store.md)——绑定语义（白名单治理）不变，仅存储位置迁移。
