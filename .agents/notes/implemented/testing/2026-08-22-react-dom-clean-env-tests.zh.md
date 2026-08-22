# Agent Note：react-dom 必须显式声明——干净环境的 CI 揭穿了 home 目录残留的遮掩

Status: implemented

[English](2026-08-22-react-dom-clean-env-tests.md) | 中文

## 问题

第一个跑到测试阶段的 CI 运行在 context-guard 的 client 测试里挂了：vite 无法解析 harness `ui-primitives/src/Menu.tsx` 导入的 `react-dom`。同样的测试在每台维护者机器上都是绿的，让失败看起来像是 CI 特有。其实不是——CI 环境是唯一*诚实*的那个。

## 决定

八个在测试中渲染 harness client 组件的包，现在在 devDependencies 里声明 `react-dom`(context-guard、datasets、local-agent、local-agent-dsh、message-tools、mission、session-title-edit、ui-shortcuts)，版本规格与各包的 `react` 对齐，沿用既有先例（message-timeline、taskpilot、ui-file-preview)。经验法则：测试会拉入 harness client 源码的包——任何 `@testing-library/react` 触及的、或任何用到 portal 的 harness 组件——都必须自己声明 `react-dom`;`@testing-library/react` 把它列为 peer，而 pnpm 不会把间接依赖的 peer 自动装进导入方。

## 为什么本地是绿的

两层遮掩叠加：

- `build/vitest.ts` 的 `dshTestConfig` 只在能从调用包解析到时才给 react/react-dom 建别名——维护者机器上向上查找撞到了一个**残留的 `/Users/<name>/node_modules/react-dom`**(home 目录里的旧安装），于是别名在本地悄悄存在，在 CI 从不存在。
- 别名缺席时，`resolve.dedupe: ['react', 'react-dom']` 强制从项目根解析，在任何干净环境里都会失败——正是 CI 报的那样。

这个残留的 `~/node_modules` 也是之前若干"CI 红、本地绿"谜题难以复现的原因。失败看起来环境特异时，复现意味着复制 CI 的*拓扑*（新鲜 checkout、harness 嵌在仓库内、无用户级状态）——`/tmp/ci-repro` 就是这么做的，几分钟内复现了失败。

## 后果

- CI 现在是测试专用导入依赖卫生情况的权威判据；机器带用户级状态时，"本地绿"不算证据。复现配方（新鲜 worktree + 嵌套的跟踪版本 tag 的 harness + `CI=true`）是未来一切"CI 红、本地绿"案例的参照。
- 维护者应自查各自机器上残留的 `~/node_modules`——任何做向上解析的工具都会被它恰好掩盖这类 bug。

## 否决的替代方案

- **在 `dshTestConfig` 里无条件给 react-dom 建别名**——否决：这会再次掩盖真实缺失的声明；诚实的修法是把依赖声明出来。
- **写个检查器强制声明**——未做：CI 绿了之后 CI 本身就是检查器；专门的 lint 只是复述干净环境测试阶段已经证明的事。
