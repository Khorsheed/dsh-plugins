# @khorsheed/dsh-eval-suite

[English](README.en.md) | 中文

在自己电脑上比较编码 agent 的模式：让 Kimi、Codex、Claude Code、DSH 做同一批题、在同样的条件下，结果并排摆出来。

以前想知道「这类活交给 Codex 好还是 Claude Code 好」，只能挨个开终端、手工喂题、凭印象比；换个模型再比一次，上次的条件早就对不上了。切到评测模式，你告诉 agent 用哪套题、比哪几家，它替你起草实验；你点头开跑后，它把每道题分给对应的工具去做、收卷、打分，每一步都记账。最后每道题一行，两边的得分和差距并排摆在你面前。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/suite-bundle-eval-hero.png" width="640" alt="评测模式的会话：右侧「实验室」页显示一个实验的结果对比，每道题一行，两组的得分与差值并排">

## 可以这样跟 agent 说

- 「列出已经登记的题集，每个有多少题？」
- 「起草一个实验：用这个题集比较 Codex 和 Claude Code，同一个模型，各跑一次。」
- 「把这个目录里的题整理成题集，检查一遍，再提交登记。」
- 「读一下上次的结果，写一份分析初稿。」

## 里面有什么

- **数据集**：「题集」页。题集登记后版本就固定了，只能读不能改，每次比的都是同一批题。
- **评测**：「实验室」页。从设计实验、看运行记录、对比结果到人工评估，一步步走；每道题的每一次运行都记在账上，可以导出复核。
- **实验单元**：想让每家工具在干净的环境里做题，就给它开一个独立的 Docker 容器。
- **本机编码工具**（Kimi、Codex、Claude Code，还有默认关着的本机 DSH 委派）：被比较的就是它们。

agent 能起草实验、整理题集、写分析，但开跑、批准题集登记、给出最终评分都是你的事。开跑后在后台进行，关掉会话也照常跑。人工评估时，同一道题的几份答案并排放着，看不出是哪家做的；样本不够时，报告会直接说不排名。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-eval-suite
```

最好再装一个 `@khorsheed/dsh-basic`（基础体验），改消息、看文件这些日常功能在那里。装完开一个新会话，选「评测模式」，告诉 agent 你想比较什么。

这些功能只在评测模式的会话里出现，在其它模式里看不到是正常的。

## 已知限制

- 用容器做题要电脑上有能用的 Docker；没有也能直接在本机跑，评测用的镜像要自己准备。
- 被比较的各家工具要你自己先装好、登录好，本套件不代装。

## Compatibility

需要 DSH 0.2.0 或更新版本，已在 0.2.1 上验证。

## 给开发者

命令行安装（和上面效果一样）：

<!-- collection:start -->
推荐连同基础体验一起装(「评测」集合,一条命令):

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-eval-suite
```
<!-- collection:end -->

- 本包自己不带功能，只负责把评测模式和上面这些成员一起装上；卸载（`dsh plugin --profile web remove @khorsheed/dsh-eval-suite`）也是一起移除，只想关一个就在套件详情页里单独关。
- 每个成员的详细说明在它自己的 README 里：[packages/](https://github.com/Khorsheed/dsh-plugins/tree/main/packages)。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
