# @khorsheed/dsh-lab

[English](README.en.md) | 中文

让评测的每一格都在自己的 Docker 容器里跑：环境一样、互不干扰、跑完就收走，还能对得上是不是同一个环境。

对照实验要比的是 agent，不是环境。同一批题几家各跑几次，只要有一格多挂了个目录、换了个网络、内存上限不一样，结果就没法比了，而这种差别事后很难查出来。装上之后，你在评测里把实验设成在容器里跑就行：它替每一格开一个干净的容器，把题放进去、让 agent 在里面做完、收回产出，过了检查再销毁。最后每一格都带着一个环境指纹，指纹一致，就说明环境确实是同一个。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-record-env.png" width="640" alt="实验室运行记录详情：参数表里的环境指纹和容器单元，和同一次运行里其它格子的指纹一致">

## 能做什么

- **每格一个干净的容器**：一格一个容器，互不串味；跑完一格收一格，不留垃圾。
- **环境是不是同一个，看指纹就知道**：镜像、资源上限、挂载、网络、用户都算进指纹，在「运行记录」里逐格显示；声明了什么就真给容器加上什么。
- **出错了先留现场**：某一格崩了，产出和现场先收好存档，再为这一格重开一次，不影响其它格。
- **没检查完不让删**：容器要等这一格的记录核对完才会销毁，不会把还没收好的结果一起删掉。
- **重启也不丢**：DSH 重启后，还在跑的容器会被重新认领，接着管。
- **剩下的容器一眼看到**：没收走的容器列在「结果对比」页的「未回收单元」里，点「回收」就能清掉。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/lab-run-units.png" width="640" alt="结果对比页的「未回收单元」一节：列出这次运行还占着的容器、所属格子的状态和「回收」按钮">

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-eval-suite
```

实验单元会跟着「评测套件」一起装好。它没有自己的界面，信息都显示在评测的「实验室」页面里。电脑上要装好 Docker，并且能在命令行里用 `docker`；装完开一个「评测模式」的新会话，让 agent 起草实验时说一声「每格放进容器里跑」。

## 已知限制

- 目前只支持 Docker。
- 指纹记的是你声明的配置，不是实测的机器：两台电脑的 CPU、内核不同，它看不出来。要保证不能上网，得在实验里明确声明一个断网的网络。
- 使用的镜像里要有 `sh` 和 `sleep`。

## Compatibility

需要 DSH 0.2.0-rc.2 或更新版本，已在 0.2.1-rc.1 上验证；没有任务账本时的降级行为，见[参考文档](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/lab/docs/reference.md)。

## 给开发者

- 入口：`src/index.ts`（提供 `ctx.lab` 服务）、`src/cli.ts`（`dsh-lab` 命令，`dsh-lab status` 可以看所有单元），两者共用 `src/service.ts`。服务接口、指纹构成和失败恢复见[参考文档](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/lab/docs/reference.md)。
- 也可以单独安装（`dsh plugin --profile web add @khorsheed/dsh-lab`），用在任何需要隔离、一致环境的对照场景；不和任务账本（随 `@khorsheed/dsh-eval` 安装）一起用时，销毁容器要显式加 `force`。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
