# Agent Note: claude 人工交接登录 —— CLI 认证现在只在 TTY 可用

Status: implemented

[English](2026-08-22-claude-manual-login.md) | 中文

## Problem

家族的 claude 登录在 claude CLI 2.1.235 上坏了：harness 声明的是 device-code 式登录（`claude auth login`，从 stdout 抓取 prompt），但现行 claude 在非 TTY 的 stdout 上**不打印** OAuth URL——它回答 `Invalid API key · Please run /login` 然后退出，即便给全新的空 `CLAUDE_CONFIG_DIR` 也一样；备选 `setup-token` 需要 Ink raw mode，没有 TTY 直接死。core 的 prompt 抓取流程（`LocalAgentRegistry.runLogin`）因此对 claude 完全无法重新认证。这已是抓取 CLI 输出格式第二次坏掉（kimi 的 prompt 形态抓取是另一次），所以修法是让 claude 停止抓取，而不是换种格式再抓一遍。

## Decision

harness 契约上的第二个 `login` 变体（`packages/local-agent/src/index.ts` 的 `LocalAgentLogin` 联合）：在保持不变的 device-code 成员旁加入**人工交接**——`{ manual: { commandDisplay }, watch? }`。声明后 `/<harness> login` 不 spawn 任何进程：回复中给出用户在自己终端运行的确切命令，registry 每 `MANUAL_LOGIN_POLL_MS`（2 秒）轮询凭据探针（`watch ?? harness.isAuthenticated`），上限 `MANUAL_LOGIN_LIMIT_MS`（5 分钟）。回复无法携带结果（命令通道已经返回），因此成功与超时记入日志，各展示面自己的状态轮询（设置分区每几秒重新探测并弹出登录成功提示）接住落地的凭据。第二次 `/login` 替换在飞的监听——沿用既有的 pending-login 替换语义并泛化：controller 现在在 device 变体的 kill child 之外携带可选的 `stop`（取消监听）。

claude harness 的声明中，relay env 被擦除、作用域目录被钉死，逐字为：

```
env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR=<homeDir> claude auth login
```

device-code 成员逐字节不变：kimi 与 codex 的声明照旧编译、照旧行为。

## Alternatives considered

- **给 CLI 分配 PTY**——否定：伪终端依赖（node-pty 或 script(1) 包裹）既重又在平台间脆弱，而且仍要解析 TUI 帧缓冲——比它要取代的抓取更糟。
- **`claude setup-token`**——否定：它驱动 Ink raw-mode TUI（已实测：无 TTY 即死），同样的 PTY 问题外加更差的 UX（手工粘贴 token）。
- **`/login` 回复阻塞到凭据落地**——否定：挂住几分钟的回复会冻结命令节点和设置界面的 runCommand 等待；立即回复 + 状态轮询正是 device 流程既有的完成面。
- **抓取新的 TTY 输出格式**——被事故本身证据否定：连续两次抓取都坏了；TTY-only 的流程不是我们能稳定的。

## Consequences

- `/claude-code login` 恢复可用，经用户自己的终端完成；设置面板的状态轮询与登录成功提示不动，补全 UX。
- pending 槽位的替换语义现在覆盖两种变体（停监听或杀子进程），交接中途重试是干净的。
- 监听过期且无凭据只记日志——用户可见的信号是设置行保持未登录；回复文案写明 5 分钟窗口。
- 未来任何 TTY-only 的 CLI 免费获得该变体（声明 `manual` 即可，core 零改动）。

## Testing

`packages/local-agent/tests/local-agent.spec.ts` 新增 manual 变体套件（4 例，fake timers）：指引回复携带展示命令，且成功回复证明未 spawn（manual 声明根本没有可 spawn 的命令）；监听到探针翻转即停止轮询；窗口过期即停止；第二次登录替换第一次（单一监听的轮询速率）。device-code 套件未动且绿。`packages/local-agent-claude-code/tests/apply.spec.ts` 钉住声明：manual 变体在场、展示命令逐字正确（含作用域目录路径）。测试套件：local-agent 150/150，local-agent-claude-code 38/38，家族回归全绿。

## Cross-references

- harness 契约与设置面见 [local-agent 家族 note](../feature/2026-08-14-local-agent-family.md)。
