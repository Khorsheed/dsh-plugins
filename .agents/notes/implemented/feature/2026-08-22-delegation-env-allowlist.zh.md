# Agent Note: 委派 env 白名单——按需显式继承,不再默认全量继承

Status: implemented

[English](2026-08-22-delegation-env-allowlist.md) | 中文

## 问题

此前每个委派 spawn 只把 scoped home 变量作为显式 `env` 传入,子 CLI 会继承整个 scrub 后的父进程环境。于是宿主机上任何一个特定变量都可能成为隐患:claude 2.1.236 的凭证解析在 3080 上坏掉,正是因为继承了宿主的 `USER` 变量(实盘二分:全 env 减 `USER` 正常,单加 `USER` 即复现 'OAuth session expired')。每个 harness 逐个变量地修,是打地鼠。

## 决策

- 家族核心包(`@khorsheed/dsh-local-agent`,`src/env.ts`)新增 `delegationEnv(extra)` 助手:对白名单之外的每个宿主环境键打 tombstone(`undefined`),再把调用方显式条目并到最上层。作为 `SubprocessSpawnSpec.env` 使用时,seam 会把它合到 `scrubbedParentEnv()` 之上——白名单键经继承自然到达,其余全部移除。已端到端验证 tombstone 语义:node spawn 传 `KEY: undefined` 在子进程里是真正未设置(不是空串),且 claude 对空串形式也能容忍——两种拼写都安全。
- POSIX 白名单:`PATH HOME TMPDIR SHELL TERM`、locale(`LANG LC_*`)、`XDG_*`、`SSH_AUTH_SOCK`、`NO_COLOR`、`GIT_TERMINAL_PROMPT`,以及大小写两种形式的代理变量。`USER`/`LOGNAME` 明确排除(claude 的教训;git 从 `HOME` 的 gitconfig 取作者)。Windows:`PATH PATHEXT SYSTEMROOT SYSTEMDRIVE WINDIR COMSPEC TEMP TMP USERPROFILE HOMEDRIVE HOMEPATH APPDATA LOCALAPPDATA PROGRAMDATA` + 代理变量,按平台语义大小写不敏感匹配。
- 全部 11 个委派 spawn 点(kimi/codex/claude/dsh × exec fresh/resume + live driver)的显式 env 都改走 `delegationEnv`。调用方显式条目永远优先——凭证(`DEEPSEEK_API_KEY`)、scoped home 变量、`ANTHROPIC_BASE_URL` 覆盖与之前完全一致。claude provider 各点的 `USER` tombstone 退役,由白名单统一覆盖。
- 子进程确实需要白名单之外的键时,必须由 provider 显式传入——这点摩擦正是设计意图:委派 env 是经过审视的,不是无意中继承的。

## 考虑过的替代方案

- **按事故逐 harness 补 tombstone**——维持现状;每个新宿主变量都先酿成一次线上 P0(`USER` 事故)才变成 tombstone。
- **用空串覆盖代替 `undefined` tombstone**——对 claude 有效,但对任意消费方不保证等价于"不存在";tombstone 才是真正的移除,seam 已有文档化语义。

## 影响

- 登录流程有意不收敛:交互式 `/<harness> login` 的 spawn 保留全量环境(要开浏览器,需要用户完整上下文)。
- provider 内部 option 类型(`start*CliRun` 的 options、`memberEnv`)从 `Record<string, string>` 放宽为 `Readonly<NodeJS.ProcessEnv>`,tombstone 才能通过类型检查。
- provider 测试里既有的 `toEqual` env 断言继续通过(vitest 忽略 undefined 值属性);助手的新测试在 `packages/local-agent/tests/env.spec.ts`。
