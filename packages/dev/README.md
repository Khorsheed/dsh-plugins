# @khorsheed/dsh-dev-suite

[English](README.en.md) | 中文

在 DSH 里写代码的模式：活可以交给你电脑上的 Codex、Claude Code、Kimi，几个 agent 能在一个会话里分工，抬头就知道这个会话在哪个分支上。

以前想让本机的 Codex 或 Claude Code 帮一把，得自己开终端、复制粘贴、再把结果搬回来；同时开着几个 worktree，还得敲 git 才知道这个会话对着哪个分支。切到开发模式，你说一句「交给 Codex」，它就在本机跑起来，过程在子会话里看得见；会话顶上直接显示分支和改了多少行；活大了，请几个 agent 进来分工，验不验收还是你说了算。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/dev-mode.png" width="640" alt="开发模式的会话：协作间正在邀请成员，会话顶上是分支徽标和改动抽屉，输入框上方是子 agent 的任务胶囊">

## 可以这样跟 agent 说

- 「把 parser 里这个 bug 交给 Codex 修，修完告诉我改了哪些文件。」
- 「新建一个 worktree 做登录页重构，在那边干活，别动 main。」
- 「邀请 Claude Code 和 Kimi 进来：Claude Code 写实现，Kimi 补测试，你来协调，最后给我看证据。」
- 「这个仓库有哪些 worktree？哪些还有没提交的改动？」

## 里面有什么

- **本机编码工具**（Kimi、Codex、Claude Code）：你说交给谁，它就把活派过去；过程实时可见，可以中途停下，也可以接着聊。
- **本机 DSH 委派**：把子任务交给另一个单独运行的 DSH。默认关着，要用就在设置的「本机 DSH 委派」卡片里打开。
- **协作间**：点「＋ 邀请 agent」，会话就变成一个小团队；你 @ 谁派活，协调者拆任务，成员交证据。
- **工作树**：会话顶上显示当前分支和改动行数，点开就是待提交的改动和提交记录；让 agent 新建、切换、删除 worktree 也行，有没提交改动的不会被删。
- **快速决策**：「是不是」「选哪个」这类判断，agent 能拿到带把握程度的答案，而不是一段还要再读的话。
- **重启守卫**：agent 改完代码要重启时，先确认构建和测试都过了才放行，免得改坏的代码把正在进行的对话一起带走。
- **上下文透镜**：看每次请求到底给模型发了什么、占了多少 token。

计划、压缩、子 agent、网页检索这些标准模式里的能力都还在。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-dev-suite
```

最好再装一个 `@khorsheed/dsh-basic`（基础体验），改消息、看文件这些日常功能在那里。装完开一个新会话，选「开发模式」，告诉 agent 你要做什么。

这些功能只在开发模式的会话里出现，在其它模式里看不到是正常的。

## 已知限制

- Kimi、Codex、Claude Code 要你自己先装好、登录好，本套件不代装。
- 快速决策要先配 TypeSafe 的 key，没配时它只会说做不了，不会出错。
- 重启守卫只在有看门狗守护的实例上起作用。

## Compatibility

需要 DSH 0.1.7 或更新版本，已在 0.2.1 上验证。

## 给开发者

命令行安装（和上面效果一样）：

<!-- collection:start -->
推荐连同基础体验一起装(「开发」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-dev-suite
```
<!-- collection:end -->

- 本包自己不带功能，只负责把开发模式和上面这些成员一起装上；卸载（`dsh plugin --profile web remove @khorsheed/dsh-dev-suite`）也是一起移除，只想关一个就在套件详情页里单独关。
- 每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
