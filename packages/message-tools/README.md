# message-tools

dsh 插件：给用户消息加上**编辑**和**撤回**。

agent 回错话了？不用重开对话。把消息就地改掉重新发送，或者撤回它——撤回会连同这轮引发的文件改动一起处理，还能一键恢复。

## 安装

需要 dsh 宿主：

```sh
npm install @deepseek-ai/dsh
dsh plugin --profile web add @khorsheed/dsh-client-message-tools
npx @deepseek-ai/dsh web
```

装完即用，无需配置。卸载：

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-message-tools
```

## 它能做什么

**编辑**：把鼠标移到任意一条用户消息上，出现编辑按钮。点击后消息就地变成输入框，改完重新发送——模型看到的是改后的内容。

**撤回**：同样的位置有撤回按钮。点击弹出确认框，列出这轮消息引发的文件改动（哪个文件、加了几行减了几行）。确认后：
- 这条消息和该轮的回复从对话流中隐藏
- 相关文件改动被快照（不真删文件）
- 对话流中出现一条分隔线，标注"已撤回 N 条消息"

**撤回撤回**：未来支持在分隔线上恢复被撤回的消息和文件改动（文件快照已就绪）。

## 工作原理

- **零侵入**：通过 dsh 的 slot shadow 机制（priority -1）接管用户消息渲染，不改官方代码；卸载即恢复
- **官方组件**：确认弹窗用官方 `RiskConfirmation`，按钮用官方 `Button`，样式走主题 token（暗/亮自动适配）
- **事件持久化**：编辑/撤回写入会话日志（`user/message/edited` / `user/message/withdrawn`，带 `ignorable` 标记）
- **文件快照**：撤回时把相关文件内容存到会话状态目录，供撤回撤回恢复

## 开发

```sh
git clone https://github.com/Khorsheed/dsh-client-message-tools.git
cd dsh-client-message-tools
pnpm install && pnpm run build && pnpm test
```

## 平台

需要 dsh web 宿主（macOS / Linux）。

> 状态：编辑、撤回、文件快照已实现（14 项测试）。撤回撤回的 UI 入口待下一里程碑。
