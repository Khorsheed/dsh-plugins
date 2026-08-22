# Agent Note：pty 登录变体——CLI 自己开浏览器，我们只给它一个终端

状态：已实现

[English](2026-08-22-local-agent-pty-login.md) | 中文

## 问题

[手动接力登录](../bug-fix/2026-08-22-claude-manual-login.md)把 claude 重授权变成了终端差事：复制命令、打开终端、回来。第一代流程体验更好——点登录，浏览器自动打开。它在 claude ≥2.1.235 把授权改成 TTY-only 后失效，手动接力笔记当时否决 PTY 的理由是"仍要解析 TUI 帧缓冲"。

## 决策

那个否决有一个事实错误：PTY 下 CLI **会自己打开浏览器**，并把 OAuth URL 以纯文本兜底打印（已对 claude 2.1.236 实测）——不需要解析任何 TUI。剩下的缺口只有授权页交还的 code，CLI 从 stdin 读它。

`LocalAgentLogin` 的第三个变体 `{ pty: { command, args }, watch? }`：

- spawn 走**官方 subprocess seam 的 `spawnTerminal`**（node-pty 后端，跨平台含 Windows conpty）——零新增原生依赖，不用 `script(1)`（BSD script 拒绝 socket stdin，而 libuv 的 pipe 正是 socketpair；那条路试过并放弃）。
- 从终端输出捕获 OAuth URL 放进回复作兜底链接；回复同时给出粘贴命令。
- `/<name> code <value>`（registry 级子命令）把粘贴的 code 写进终端（`\r` 结尾）。`statusOf` 暴露 `loginAwaitingCode`，设置分区恰好只在等待时渲染粘贴框。
- 完成判定复用共享的 `watchCredential`（存在性 + 新鲜 `credentialStamp`），与 manual 变体同一条 watch；替换登录时 terminate 旧终端，并入既有的终止阶梯。
- 组合缺少 subprocess seam 时降级为手动接力回复。

claude 以 pty 声明（relay env 摘除 + scoped home 固定），取代 manual 成为主路径；手动流程保留为文档化的兜底（及 seam 缺失时的降级）。

## 曾考虑的替代方案

- **`script(1)` 做 PTY 包装**——实测否决：BSD script 因 libuv pipe 是 socketpair 而报 `tcgetattr/ioctl: Operation not supported on socket`，且 macOS/Linux 旗标不一。
- **只留手动接力**——被产品方否决：点击弹浏览器是家族的一手体验，值得恢复。
- **自己解析授权页/轮询 Anthropic**——否决：流程归 CLI 所有，我们只提供终端。

## 影响

- claude 的登录/重新授权恢复点击即开浏览器（页面给出 code 时多一步粘贴——claude 2.1.235 起上游强加）。
- 未来任何 TTY-only 的 CLI 声明即用；Windows 经 conpty 可用。

## 测试

框架：pty 登录回复带出捕获的 URL、等待期 `statusOf().loginAwaitingCode` 为真、`/<name> code` 把粘贴送达终端（fake `spawnTerminal`）、无待处理登录时粘贴报错。manual 与 device 套件未动且全绿。

## 交叉引用

- [claude 手动接力登录](../bug-fix/2026-08-22-claude-manual-login.md)——本变体取代的过渡路径。
- [认证失败真实性](../bug-fix/2026-08-22-local-agent-auth-failure-truthfulness.md)——两个变体共享的 watch。
