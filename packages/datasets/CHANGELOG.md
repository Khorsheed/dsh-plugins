# 变更记录

## 0.2.0-rc.1（2026-10-24）

- 自隐 tab（题集 tab）的注册/注销切换延后到下一帧（requestAnimationFrame），避开宿主 ui-conversation `refreshViews` 对已释放会话滞留绑定的 uncaught throw 窗口期——上游修复提案见 docs/upstream-proposals/2026-10-20-refreshviews-stale-binding-robustness.md。
