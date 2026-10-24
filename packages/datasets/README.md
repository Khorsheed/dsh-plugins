# @khorsheed/dsh-datasets

[English](README.en.md) | 中文

把散在各处的题目整理成一套评测能用的题集：版本钉死，答案和评分标准不会漏给被测的 agent。

做评测最怕两件事：题目悄悄改了，前后两轮比的其实不是同一套题；答案或评分标准放在了选手看得到的地方。装上之后，你告诉 agent 题目放在哪个文件夹，它替你整理成题集、跑一遍校验，再交给你过目；你逐题看过、按「确认登记」，这套题才算数。之后每次实验都钉在登记时的那个版本上，选手只拿得到你允许它看的那部分。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-panel.png" width="640" alt="左侧栏「题集」面板：按来源分组的题集列表，写着最新版本、题数、agent 看得到哪些部分、用在哪些实验里">

## 能做什么

- **指个文件夹就能整理**：在「题集」里点「添加题集」，选「让 Agent 整理」，它会新开一个会话，把原始数据整理成题集并提交登记申请。
- **你点头才登记**：审阅页把原目录和整理后的题集左右对照，每一部分谁看得到都有开关；没问题按「确认登记」，不满意就「退回给 Agent」。
- **谁看得到什么一眼看清**：每道题的详情页并排列出「选手将看到」和「只有判官和探针看得到」，答案要是放错了地方，这里马上就能看出来。
- **题目改了不会悄悄混进来**：题库更新时，选手看不到的改动自动跟上；选手看得到的改动标「新版本待确认」，你确认之前实验还用旧版本。
- **先查一遍能不能判分**：登记前会检查每道题有没有评分标准、客观题有没有检查脚本，有问题会提醒你，但不拦着你。
- **评测会话里也能看**：同一个视图既在左侧栏的「题集」面板里，也在评测会话的「题集」页签里。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-review.png" width="640" alt="等你确认登记的审阅页：原目录和题集左右对照，各部分的可见性开关，以及「确认登记」「退回给 Agent」按钮">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/datasets-item-detail.png" width="640" alt="题目详情页：左边是按可见性着色的文件树，右边并排「选手将看到」和「只有判官和探针看得到」两栏，底部一行说这道题能不能判分">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-eval-suite
```

题集会跟着「评测套件」一起装好。装完从左侧栏打开「题集」，点「添加题集」；或者开一个新会话，选「评测模式」，跟 agent 说「把这个文件夹里的题整理成题集」。

会话里的题集工具只在评测模式里出现，在其它模式里看不到是正常的。

## 已知限制

- 题集存在 git 仓库里，只有提交过的文件才看得到；agent 整理时会先提交再申请登记。
- 题库每更新一个版本，可能多留一份只读副本，不会自动清理。

## Compatibility

需要 DSH 0.2.0-rc.2 或更新版本，已在 0.2.1-rc.1 上验证；缺少某些宿主能力时怎样降级，见[参考文档](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/datasets/docs/reference.md#兼容性细节)。

## 给开发者

- 入口：`src/index.ts`（服务、`/datasets` 和 `dsh-datasets` 命令、侧栏）、`src/tool.ts`（agent 用的工具）。仓库布局、校验规则和工具分档见[参考文档](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/datasets/docs/reference.md)。
- 也可以单独安装（`dsh plugin --profile web add @khorsheed/dsh-datasets`），存储、登记和校验不绑定评测；agent 用的工具要由某个模式授予。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
