# Agent Note: worktrees 渲染原始路径(git core.quotePath=false)

Status: implemented

English | [中文](2026-08-25-worktrees-quotepath-raw-paths.zh.md)

## Problem

`packages/worktrees` 里所有产路径的 git 命令(`git ls-files -co --exclude-standard` 仓库浏览、`status --porcelain`、`diff --numstat`、`diff --name-status`、`show --name-status`)都会把含非 ASCII 字节(中文)或空格的路径做 C 式引号+八进制转义,因为 `core.quotePath` 默认 true。比如 `algorithm/textbook/${…}/第一章.md` 会返回成 `"algorithm/.../\345\256\232...md"`。

插件的解析器按换行/制表符切分、且从不反转义。把一条带引号的完整路径按 `/` 切开,前导 `"` 就会粘在第一个目录段上,于是文件树渲染出 `"algorithm`、`"Writing`、`"Cognition_Learning` 这类带引号的目录名,以及八进制转义。同样的缺陷也影响改动(worktree)和单提交文件列表,不只仓库浏览 Tab。

## Decision

让 `src/git.ts` 里的 `git()` 辅助函数总是执行 `git -c core.quotePath=false <子命令>`。这是纯 host 端数据面改动:git 现在对所有命令输出原始 UTF-8 路径,所以现有按行/制表符的解析器无需改动即可继续工作,客户端渲染的就是真实名字。集中到一处而不是逐命令添加,避免将来某个产路径的调用忘记这个参数。

## Verification

`tests/service.spec.ts` 新增非 ASCII 用例:提交的 `笔记/第一章.md` 出现在 `repoFiles` 中,且返回的路径没有一个以 `"` 开头。28 个测试通过,`pnpm run build && pnpm run test` 全绿。另对 `~/code`(一个含 102 条非 ASCII 路径的容器型仓库)手动验证:`repoFiles` 返回 1645 条、0 条带引号、全为原始 UTF-8。

## Alternatives considered

- **`-z` NUL 分隔输出。** 更稳妥——连含制表符或换行的路径也能处理——但需要把所有路径解析器改成按 NUL 切分。暂缓;仅在真出现这类路径时再引入。
- **只对产路径的调用加 `-c core.quotePath=false`。** 可行,但把参数散落在很多调用点;集中到辅助函数是更小、更一致的改动。

## Consequences

非 ASCII(及含空格)路径现在在所有地方显示真实名字:仓库浏览、改动、单提交文件列表。容器型仓库根(如 `~/code`)下的未跟踪兄弟 git 仓库和草稿目录仍会出现在仓库浏览列表里——那是另一类管理问题,本次改动有意排除在外。
