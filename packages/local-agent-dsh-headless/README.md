# @khorsheed/dsh-local-agent-dsh-headless

[English](README.en.md) | 中文

「本机 DSH 委派」背后那个不带界面的 DSH。你不需要单独安装它：装「多Agent协作」或开发套件时它会自动跟着装好。

## 它是什么

一个无头的 DSH 组合：调用方给定会话编号，它把任务跑完、把最终回答打到标准输出就退出；加 `--serve` 则常驻下来，一轮一轮接活。`@khorsheed/dsh-local-agent-dsh` 用它来启动「另一个 DSH」，并在之后的轮次里续上同一个会话。

和官方的 `@deepseek-ai/dsh-headless` 唯一的区别是会话编号归谁：这里由调用方用 `--session-id` / `--resume` 传入，输出里从不带会话标记。

```sh
dsh --profile headless-local-agent-dsh --session-id 6ba7... "run the tests"   # 新建
dsh --profile headless-local-agent-dsh --resume 6ba7... "run the rest"        # 续接
dsh --profile headless-local-agent-dsh --serve                               # 常驻
```

## 注意

- 不要把它加进交互式 profile：它的配置专供子 DSH 使用，混进来会影响真实会话，启动时会直接报错。
- 用 `dsh plugin add` 直接装它不会挂载任何东西；经 `@khorsheed/dsh-local-agent-dsh` 间接安装即可，子 profile 会自动准备好。

## Compatibility

需要 DSH 0.1.5-rc.1 或更新版本，已在 0.2.1-rc.1 上验证。

## 给开发者

- 命令行参数（`--model` / `--effort`）、常驻模式的通信协议、子 profile 的组成与限制，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/local-agent-dsh-headless/docs/reference.md)里；通信协议的定义在 `src/wire.ts`。
- 隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins)，问题与贡献请到该仓库；变更见 [CHANGELOG.md](CHANGELOG.md)。
