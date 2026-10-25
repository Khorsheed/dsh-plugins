# @khorsheed/dsh-ankh-guard

[English](README.en.md) | 中文

让 agent 自己改代码、自己重启，还不把服务搞挂。

让 agent 改 dsh 自己的代码很方便，麻烦在重启那一下：改坏了，服务连同正在聊的会话一起挂掉，只能你去收拾。装上重启守卫，agent 想重启得先证明「构建和测试都过了」，过了才放行；重启后它自己检查新服务是否正常，起不来就自动退回上一个能用的版本，被打断的会话也会接着聊。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/ankh-guard.JPG" width="640" alt="一次受守护的重启:重启前告知验证项,重启后金丝雀自动激活会话并注入上下文继续验证">

## 能做什么

- **没测过就不让重启**：构建或测试没过，agent 发起的重启直接被拦下，旧服务照常运行。
- **重启前先预演**：真正停机前，先在后台把新版本完整启动一遍；起不来就不碰旧的。
- **挂了自动退回**：新版本连续起不来，自动退回最后一次正常启动的版本；如果是新装的插件把服务搞坏了，就把它卸掉，并告诉你卸了什么。
- **重启完自己汇报**：发起重启的那个会话会收到结果，不用你去翻日志。
- **聊到一半的会话接着聊**：被重启打断的会话自动恢复，继续刚才的活。
- **网页自己刷新回来**：开着的页面等新服务就绪后自动刷新，回到原来的位置。

## 安装

在 DSH 的「插件 → 添加插件」里输入下面的包名，点安装：

```
@khorsheed/dsh-ankh-guard
```

它也随「开发套件」（`@khorsheed/dsh-dev-suite`）一起提供。装好后让 agent 照着随包的「安全重启」说明操作就行。

## 用之前要准备好

- **部署目录是一个 git 仓库**：「测过了」的证明和退回旧版本都靠 git 记录。
- **agent 不受沙箱限制**：启动 DSH 时设 `DSH_PERMISSION_MODE=danger-full-access`，或在会话里输入 `/permission danger-full-access`，否则 agent 没法停止和拉起服务。
- **第一次重启交给命令行**：装好后先运行一次 `dsh-ankh-guard supervise`，把服务交给守卫看管；之后的重启 agent 自己就能完成。

## 已知限制

- 只管得了经过守卫的重启；绕开它手动停服务，仍可能把服务搞挂，这时由自动退回兜底。
- 服务崩溃（而不是正常停止）时，被打断的会话不会自动续上，要等你打开它时才恢复。
- 只支持 macOS 和 Linux。

## Compatibility

需要 DSH 0.1.5 或更新版本，已在 0.2.1 上验证。

## 给开发者

- 命令行 `dsh-ankh-guard` 的全部命令、自我重启的六步流程、watchdog 和 launchd / systemd 的部署方式、启动配置切换、各配置项，都在[完整参考](https://github.com/Khorsheed/dsh-plugins/blob/main/packages/ankh-guard/docs/reference.md)里。
- 入口：`src/index.ts`（应用内的服务和说明）、`src/cli.ts`（命令行）、`scripts/dsh-watchdog.sh`（watchdog）。
- 在 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) 开发，另有单插件镜像仓 [dsh-ankh-guard](https://github.com/Khorsheed/dsh-ankh-guard)；变更见 [CHANGELOG.md](CHANGELOG.md)。
