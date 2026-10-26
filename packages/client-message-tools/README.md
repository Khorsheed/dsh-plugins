# @khorsheed/dsh-client-message-tools

[English](README.en.md) | 中文

发出去的话还能改、还能撤——撤回是真的让模型忘掉，不只是在界面上藏起来。

话说快了、方向跑偏了，以前只能再发一条往回找补，跑偏的那段还一直留在模型的记忆里。装上消息工具，你发的每条消息下面都有一排小按钮：想换个说法就点编辑，改完重新发，模型照新内容重新回答；想当没说过就点撤回，这条和它后面的内容模型都不会再看到，原话还会放回输入框，等你改好再发。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions1.png" width="560" alt="用户消息下方的复制、编辑、撤回操作按钮">

## 能做什么

- **改完就重新回答**：点编辑，消息原地变成输入框，还能顺手换个模型；点「保存并重新发送」，模型从这里重新回答。改过的消息还能再改。
- **撤回是真忘掉**：撤回后这条消息和它后面的内容都不再进入模型的上下文，对话里只留一条「已撤回 N 条消息」，点开还能看原文。
- **原话回到输入框**：撤回的那句话自动放回输入框，改一改再发；它不会替你发出去。
- **后悔了能放回来**：点「恢复到对话末尾」，撤回的内容原样回到对话最后。
- **长消息自动折起**：贴了一大段的消息折成十来行，点「展开全部」再看；最新那条一直展开着。
- **@ 过的会话一眼认出**：消息里 @ 了另一个会话，气泡里显示成带会话标题的小标签，不是一串链接。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions2.png" width="560" alt="原位编辑：消息变成带模型选择的输入框，保存后以新消息重新发送，被编辑消息不再进入模型上下文">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions3.png" width="560" alt="撤回前的确认弹窗：说明这条消息及其后内容将对模型隐藏、原文会回填到输入框">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions4.png" width="560" alt="撤回后的内容折叠为可展开的分隔线，底部有「恢复到对话末尾」按钮">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions5.png" width="560" alt="恢复后消息原样回到对话末尾，归入「已恢复」分组">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-basic
```

消息工具会跟着「基础体验」一起装好。装完在任意会话里，你发过的消息下面就有这排按钮。

## 已知限制

- 编辑和撤回只带回文字：原消息里的图片不会跟着重发或回到输入框，要的话自己再传一次（撤回记录里还能看到它们）。
- 恢复是把内容放回对话末尾，不是放回原来的位置；当时 agent 调用工具的过程不会重演。
- 还在排队、没发出去的消息不归它管，用输入框上方的排队条去改。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 各宿主版本线的兼容细节、编辑 / 撤回 / 恢复的实现原理和对模型上下文的影响，见[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/client-message-tools/docs/reference.md)。
- 也可以单独安装：在「添加插件」里输入 `@khorsheed/dsh-client-message-tools`，或 `dsh plugin --profile web add @khorsheed/dsh-client-message-tools`，重启后生效。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
