# Agent Note: Desktop DSH 启动与账号委派

Status: implemented

## 问题

本地 DSH provider 把 `process.argv[1]` 当作 CLI 入口。打包 Desktop 中它是 Electron Host 入口，因此实际可用的内置 CLI 被误报为不存在。账号登录也无法用于委派：所选路线只支持继承 API-key 引用，而官方账号 provider 要求通过 `x-dsh-auth-token` 发送账号 token。

## 决策

`dshLaunchArgv` 保留显式 `cliLaunch` 覆盖，然后探测 Electron `process.resourcesPath` 下官方的 `runtime/cli/bin/dsh`（Windows 为 `dsh.cmd`）。资源不存在时保留原有父入口回退。版本检测与实际委派使用同一组启动参数，容器启动继续使用目标自身的显式配置。

所选 `deepseek-account` 路线通过父实例的 `deepseekAccount.resolveToken(url)` 获取授权。只继承公开 provider 目录允许的账号路线；宿主没有账号服务或方法时保持原有 API-key 行为。token、已批准的来源和所选公开配置通过显式启动环境传递。内存指纹包含这些信息，因此发生变化后下一轮重建常驻进程，同时保留原会话。

生成的子 profile 配置官方账号 provider，但不嵌入凭据。账号启动时，headless bundle 停用 base 账号服务，挂载官方 `DeepSeekAccount` 的作用域子类。只有 token 读取发生变化：它读取父实例已经批准来源的启动授权。官方模型与网页 provider 的鉴权协议不变。拒绝失效 token 不会撤销父实例的授权；下一次启动重新解析。子 DSH 不写入凭据记录，也不引入独立登录流程。

这扩展了[所选模型继承](2026-10-09-dsh-selected-model-inheritance.zh.md)，不复制父 profile 或凭据库。

## 考虑过的替代方案

**把账号 token 当作 `DEEPSEEK_API_KEY` 传递。** 不采用：账号路线使用不同的请求头与失败语义，改名会绕过官方来源校验，可能把授权发往错误目标。

**复制父实例的凭据记录。** 不采用：这会暴露无关存储，并混淆重新认证与撤销的所有权。通过官方服务解析一次启动授权已经足够。

**硬编码某个 Desktop 安装路径或隐藏版本错误。** 不采用：安装位置和平台不同，隐藏错误仍会让委派不可用。打包资源位置稳定，并保留显式覆盖。

**修改上游宿主。** 不采用：官方 Desktop CLI 资源与账号服务已经提供所需接口。

## 影响

子进程获得可用的账号 token，与 API-key 子进程获得所选凭据相同；这不提供同一操作系统用户之间的进程隔离。子 DSH 在 401 后不能使父实例 token 失效，重新认证由父实例负责，并在后续启动生效。

验证覆盖 API Key 行为保持、未登录时不回退 API Key、来源限制、不写入凭据库、官方账号目录、打包启动入口与覆盖优先级。local-agent-dsh 的 250 项测试与 headless 的 60 项测试通过。Electron Node 能解析内置 CLI 并返回 `0.2.2-rc.3`。真实 Desktop CLI 子 profile 完成握手和账号模型准备；提交内的真实 CLI 集成测试还完成本地模拟常驻轮次，检查 `x-dsh-auth-token`、回答、落定与退出，全程不使用真实授权。
