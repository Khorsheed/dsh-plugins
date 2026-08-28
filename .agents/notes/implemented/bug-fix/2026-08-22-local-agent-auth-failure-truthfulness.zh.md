# Agent Note：认证失败的真实性——新鲜度登录 watch、吊销标记、401 检测

状态：已实现

[English](2026-08-22-local-agent-auth-failure-truthfulness.md) | 中文

## 问题

一个被吊销的 claude OAuth token 在家族 UX 上暴露了两个谎言（3080 事故，2026-08-22）：

1. **手动接力登录没有发生任何登录就报成功**：watch 轮询的是存在性探测（scoped `.claude.json` 里的 `oauthAccount` 记录），被吊销 token 的残留标记第一轮就满足了它。
2. **状态行一直显示"已认证"**：存在性探测看不到服务端吊销，直到委派真的失败才暴露——且失败没有给出重新授权的指引。

## 决策

- **harness 契约新增 `credentialStamp?`**：凭证标记的 mtime（claude `.claude.json`、codex `auth.json`、kimi `credentials/` 目录最新文件）。一次完成的登录必然重写标记，stamp 因此能区分"新登录"和"残留"。
- **手动登录 watch 要求新鲜度**：存在性 + `stamp > watchStart`。残留标记只会让 watch 继续轮询，不再误报成功。
- **`registry.reportAuthFailure(name, detail)`**：provider 在失败形态命中各 CLI 的窄签名时上报（claude `failed to authenticate|authentication_failed|oauth access token`，codex `401 unauthorized|unauthorized|…`，kimi `401|unauthorized|…`）。`statusOf` 对"存在但 stamp 早于标记"的凭证降级为未认证；下一次真实登录重写标记后自动恢复，无需显式清除。
- **检测在进程退出后读 seam 的 `collected` 缓冲**，不读流式变量：`done` 可能先于流数据事件 settle，settle 时读取会与 flush 竞争（测试实锤）。镜像链本就在退出后运行，检测并入其中。
- **claude 的 stream-json 解析器**在 `is_error` 时改从 result 事件的 `result` 字段取错误详情（真实 401 的文本在这里；`error` 字段降级为兜底）——此前认证失败只显示笼统的 "claude -p reported an error"。
- **claude 探测同时校验 keychain 凭证的 `expiresAt`**（`security find-generic-password -s "Claude Code-credentials-<sha256(home)[:8]>" -w`）：本地过期即未认证；吊销只能服务端判定，走 401 标记路径。

## 曾考虑的替代方案

- **每次状态轮询都做网络验证**——否决：状态每几秒被轮询一次；吊销可见性在每次失败委派时付一次成本即可，不为轮询付。
- **在 settle 链检测（流式变量）**——测试证据否决：流滞后于 `done`，快速失败会间歇性漏检。

## 影响

- 被吊销/过期的凭证在第一次失败委派后的一个状态轮询内如实显示未认证，委派报错指明重新授权。
- 手动登录 watch 不再被残留标记误判成功。
- dsh harness（API key、无 OAuth 标记）不参与：无 `credentialStamp`、无标记。

## 测试

框架：残留标记不误报、新标记正常收尾；`reportAuthFailure` 后 `statusOf` 降级、标记重写后恢复。三 provider：认证形态失败触发 `onAuthFailure`、非认证失败不触发；fake 通过 `collected` 缓冲供文本以钉住 drain 语义。

## 交叉引用

- [claude 手动接力登录](../bug-fix/2026-08-22-claude-manual-login.md)——本批加固的 watch。
- [CLI 子代理 resume](../feature/2026-08-16-local-agent-resume.md)——本批扩展的注册表。
