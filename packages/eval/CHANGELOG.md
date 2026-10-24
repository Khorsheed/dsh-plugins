# 变更记录

## 0.2.0（2026-10-24）

- **版本号去掉 rc**:社区包不再发 prerelease 版本(docs/publishing.md「版本号规则」),首发即 0.2.0;本节原记为 0.2.0-rc.1。
- **任务账本并入**:原 `@khorsheed/dsh-mission`(从未发布)由本包的 `eval` 行一并挂载(工具行改名 `@khorsheed/dsh-eval/mission/tool`,`dsh-mission` 命令随本包安装)。原来单独的 `mission` 行取消;`mission` 服务名、`dsh-mission` 命令与数据目录(`$DSH_HOME/state/mission`)都不变,eval 与 lab 的调用方式不受影响。mission 的历史文档与变更记录见 `docs/mission/`。
- 自隐 tab（实验室 tab）的注册/注销切换延后到下一帧（requestAnimationFrame），避开宿主 ui-conversation `refreshViews` 对已释放会话滞留绑定的 uncaught throw 窗口期——上游修复提案见 docs/upstream-proposals/2026-10-20-refreshviews-stale-binding-robustness.md。
