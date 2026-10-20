# Agent Note:eval 退役 claude 容器 scope 守护

状态:已实现

## 问题

`claudeScopeDiagnostics`(CLAUDE_CONTAINER_SCOPE_MISSING / SHARED)拒绝跨宿主/容器线共用 scope 的 claude 条件。它的前提是 OAuth:单次 refresh token 会在宿主钥匙串与容器内挂载的凭据文件两边各自轮换,端点在轮换时作废旧 token 家族——后刷新的一侧把另一侧踢死(线上实测)。家族端点凭据制落地后(2026-10-19 claude-code 笔记、2026-10-20 家族笔记),API key 不刷新不轮换,守护要防的互踢不复存在。

## 决策

守护本体、两个诊断码、locale 条目、规格块、以及随之失去用途的 `ScopedConditionRef` 管线一并移除。剩下指向 `/<家> login` 的措辞(凭据目录报错信息、schema 描述、数据集编写协议里被引用的 schema 块、双语 README)改为端点凭据(`endpoint-auth.json`);协议规格的防漂移闸同步了文档更新。

每条件 `scope` 本身不动——它仍给条件一份自己的作用域目录(隔离、一次 run 比两把 key),只是不再假装在保护凭据免受轮换。

## 考虑过但未取

- **降级为警告。**否决:前提已不存在的警告只会训练运维无视就绪报告;一条无法诚实触发的规则不该假装它能。
- **为契约文档的旧时代保留守护。**否决:校验面对的是今天的 harness 行为,而今天的 harness 没有可互踢的东西。

## 影响

- 容器里的 claude 条件现在可以省略 `scope`——实例缺省 scope 与宿主共用同一把端点 key 是安全的。已声明 scope 的既有契约校验结果不变。
- 刻意留下的后续:数据集编写协议在挂载段落里仍有一处"the one /<harness> login writes into"(那句的重点是挂载而非登录)——下次动协议文档时顺手扫掉。
