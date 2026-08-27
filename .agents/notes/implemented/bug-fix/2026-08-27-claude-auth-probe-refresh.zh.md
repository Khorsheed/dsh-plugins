# Agent Note: claude 认证探测——判定前先同步 keychain，refresh token 有效期算数

Status: implemented

[English](2026-08-27-claude-auth-probe-refresh.md) | 中文

## Problem

prod 3080 上 Claude Code 一直显示未登录（红），用户重新授权的流程卡在"code 已提交，等待授权完成…"——但凭证其实是好的：手工用 scoped home 跑 `claude -p` 成功，并就地刷新了 keychain 条目。两个探测缺陷叠加：

1. claude 2.1.236 在 macOS 上把刷新后的凭证写进 **keychain**，不碰 `.credentials.json`。探测先读文件、用过期的 `expiresAt` 判死——凭证明明能用却永远显示红。`syncClaudeCredentialFile`（keychain→文件镜像）只在登录 watch 路径上跑，普通探测从不调用。
2. 探测对任何超过 `expiresAt` 的 access token 一律判死，无视 `refreshTokenExpiresAt`——但 CLI 会在使用时自动刷新，access 过期 + refresh 有效（本次事故里 refresh 到 2026-09-18）完全可用。误报的红点把用户引进了一次本不需要的重新授权，而那次交换也没写入新凭证。

## Decision

`claudeAuthenticated` 现在判定**之前**先把 keychain 镜像进文件（`syncClaudeCredentialFile` 有内容比对，macOS 上 CLI 永远先写 keychain，新鲜文件不会被旧 keychain 覆盖）；文件（`credentialFileExpiry`）与 keychain（`readCredentialExpiry`）两处读取都取 `expiresAt` 与 `refreshTokenExpiresAt` 的**较晚者**。只有两个都过期才判未认证。

## Alternatives considered

- **起 CLI 探测**——早有定论的否决（文件里有记载）；每次探测一次 `security` 读取比起动 CLI 便宜得多，同步后精度足够。
- **只认 access token 过期**——即原行为，已被"CLI 用时自动刷新"证伪。

## Consequences

- CLI 跑一轮刷新 keychain 后，下一次探测会把它同步进文件并显示绿——卡片状态点和 section 行重新一致。
- 两轮运行之间，access 过期但 refresh 有效的凭证读作已认证，与委派的实际行为一致。
- 本次卡住的"code 已提交"流程其实是误报驱动的多余操作（凭证本不需要更换）；pty 交换自身的可靠性是另一条未验证路径，另行跟踪。

## Testing

`records.spec.ts` +2：access 过期 + refresh 有效判已认证；较新的 keychain 内容在判定前被镜像进文件（stub 的 `security` exec）。套件：claude-code 88/88。

## Cross-references

- [kimi 凭证哨兵](2026-08-27-kimi-credential-sentinel.md)——同期的事故姊妹篇。
