# @khorsheed/dsh-eval

[English](README.en.md) | 中文

把几家本机 agent（Codex、Claude Code、Kimi、dsh）放进同一套题里比一比：你选题集和对比组，它替你跑完、判分，把结果并排摆出来。

想知道「这类任务换个 agent、换个模型会不会做得更好」，以前只能挨个开终端喂题、凭印象比，上次的条件早就对不上了。装上之后，你跟 agent 说想比什么，它替你起草一个实验；你看过点「批准并启动」，它一格一格交给各家去做，收卷、判分，每一步都记账。最后你拿到一页结果对比：哪组好、好多少；数据不够的时候，它会直说「暂时不能下结论」。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-lab-list.png" width="640" alt="实验室列表：实验按「需要你处理 / 运行中 / 已完成」分组，每张卡片写着题集版本、对比组、进度和一个主按钮">

## 能做什么

- **说一句想比什么就能开始**：在「实验室」里点「新建实验」，或者直接跟 agent 说；它起草题集、对比组和每格跑几次，你来改、来批。
- **开跑由你说了算**：agent 只能起草，「批准并启动」只有你能按；跑起来在后台进行，关掉标签页也照跑。
- **先试一次再花钱**：正式开跑前，每个对比组先真跑一次最小任务，登录过期、模型不对、网络不通都会提前拦下，告诉你原因。
- **判分三道关**：题目自带的检查脚本先判，盲评判官出初稿，你在「人工评估」页把几份作答并排看完再终评，看不出出自哪家。
- **结论只在能比的时候给**：「结果对比」页先核一遍「有效性校验」，条件不一致或次数太少就只给事实、不排名次。
- **每一步都有账**：每一格跑过几次、卡在哪、产出了什么都记下来，可以重试、可以导出给别人复核。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-results.png" width="640" alt="结果对比页：顶部结论卡和「有效性校验 5/5」，下面是每条判据下各对比组的得分和配对差值">

- **想要更干净的对比，就放进容器里跑**：实验可以让每一格在独立的 Docker 容器里跑，环境是否一致会逐格记下来（由「实验单元」负责）。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/eval-human-review.png" width="640" alt="人工评估页：同一道题的几份作答去掉来源后并排，每列带判据表、判官 A / B 的初判和打分输入">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-eval-suite
```

评测会跟着「评测套件」一起装好，题集和各家 agent 的接入也一并装上。装完开一个新会话，选「评测模式」，跟 agent 说你想比什么；也可以从左侧栏的「实验室」直接新建实验。

会话里的评测工具只在评测模式里出现，在其它模式里看不到是正常的。

## 已知限制

- 停下的实验不能接着跑，只能按同一份设计重开一次，旧的那次会留着当记录。
- 放进容器跑的时候一次只跑一格，会比较慢。
- 界面只在网页版里有；终端版只能用 `/eval` 命令。

## Compatibility

需要 DSH 0.2.0-rc.2 或更新版本，已在 0.2.1-rc.1 上验证；缺少某些宿主能力时怎样降级，见[参考文档](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/eval/docs/reference.md#兼容性降级与缺席项)。

## 给开发者

- 入口：`src/index.ts`（编排服务、`/eval` 和 `dsh-eval` 命令）、`src/tool.ts`（agent 用的工具），任务账本在 `src/mission/`。深入的说明见[编排与判定参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/eval/docs/reference.md)、[界面参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/eval/docs/ui.md)和[任务账本](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/eval/docs/mission/README.md)。
- 也可以单独安装（`dsh plugin --profile web add @khorsheed/dsh-eval`），但开跑需要题集（`@khorsheed/dsh-datasets`）和 local-agent 家族在场，缺哪个就拒绝并点名；agent 用的工具要由某个模式授予。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
