# Agent Note：双文件系统部署 pin `headlessBundleDir`——bundle 的 peer 必须从运行它的那份安装解析

状态：已实现

[English](2026-09-09-dsh-headless-bundle-dual-filesystem-pin.md) | 中文

## 问题

`provisionDshSubProfile` 把 `<scoped home>/profiles/<name>/node_modules/@khorsheed/dsh-local-agent-dsh-headless` 写成指向宿主安装的绝对符号链接。纯宿主世界里这是对的。T20c「一个主人，一个目录」布局下同一份 scoped home 被 bind 进容器单元，绝对目标在单元里悬空——子 dsh 的 profile 直接加载失败（`failed to apply loader entry include`）。README 里容器轮跳过 provisioning 只防住写**新**坏链接，防不住已经写在那里的；而宿主侧就绪重探会重新 provision，把宿主专用路径写回去——恰好赶在容器轮挂载同一目录之前。同一份目录现在被两个文件系统解析，而两边的依赖闭包不在同一处（宿主：profile 所在安装；单元：镜像的 `/opt/dsh-headless/node_modules`）。

桌面上有三条路：(1) 把 bundle 与运行期闭包拷进 scoped home、链接改相对；(2) 给单元加第二条挂载；(3) 调用方把 `headlessBundleDir` pin 到两边都存在的路径。

## 决策

**路 3，固化为成文契约——零代码改动。** 配置键 `headlessBundleDir` 早已存在；缺的是契约：当 scoped home 被多个文件系统解析时，把它 pin 到一条在所有文件系统里都成立的绝对路径（宿主侧：同名符号链接指向宿主安装里的 bundle；镜像侧：同名路径放真安装）。pin 住之后，就绪重 provision 只是重写同一目标，报告里描述的竞争随之消失。两份 README 已在「容器内委派」节旁写下该契约，配置表行也加了指引。

为什么不走最初诱人的路 1（「目录自包含」）：家族代码在运行期从 `@deepseek-ai/*` 导入的是**服务键与类**——`credentialRef`（dsh-credentials）、`TypertRemoteService`/`Remote`（dsh-typert-protocol）、`SessionId`（dsh-session）、`settingsNamespace`、`scrubbedParentEnv`。拷一份闭包会让这些包在 loader 自己的副本之外出现第二份实例，而 cordis 按实例身份做服务查找与类型判断：症状是静默的服务缺失与插件降级，不是启动报错。只拷家族包则死在解析上——Node 从 scoped home 向上走永远够不到安装里的 `@deepseek-ai/*`。bundle 的官方 peer 必须从**运行该子 dsh 的同一份安装**解析；pin 在两个运行时里都保住了这条不变量，拷贝必然破坏它。（路 3 的实测成功本来就依赖这条不变量：单元里 bundle 的 realpath 落在镜像自己的安装内。）

为什么不走路 2：它为恰好一家 harness 破坏 T20c 的单挂载立场，还会给 dsh 条件的复合指纹多加一个分量。

## 验证

纯文档改动（README.md + README.en.md 契约段落、配置表交叉引用）。同一分支上 `pnpm --filter @khorsheed/dsh-local-agent-dsh build` + `test` 全绿。机制本身是评测组已实测的路 3：宿主侧同名符号链接 + 镜像侧同名路径真安装在两个文件系统里都解析，dsh 容器轮 settle 为 `completed`，`observedModel` 从会话日志回读成功。

## 备选方案

**路 1：bundle + 闭包拷进 scoped home，相对链接。** 否决，见决策——`@deepseek-ai` 双实例静默破坏服务键/类身份；只拷家族包则 Node 解析不到。理由已写进 README，下一位 agent 不必重新推导。

**路 1b：拷家族包、用 shim 或 `NODE_PATH` 重定向其 `@deepseek-ai` 导入。** 否决：从绝对路径 re-export 的 shim 把每运行时路径问题往下挪了一层，而 `NODE_PATH` 对 ESM `import` 本就不生效。

**路 2：单元里加第二条挂载。** 否决：破坏 T20c「挂载只有一条」的立场；只有 dsh 需要。

**每个运行时各自在启动时写符号链接。** 否决：目录是共享的，写入互相竞争——宿主就绪重探穿插在容器轮之间正是报告撞上的交错。共享目录里的内容必须在任何时刻对两个文件系统都成立。

## 后果

- pin 是调用方的机器级前置条件：每一对共享 scoped home 的评测机/镜像都必须约定该路径（写进题库 env/README）。本包不为此提供代码。
- pin 住之后 `headlessBundleDir` 的重 provision 幂等：就绪检查再也不可能污染容器绑定的 profile。
- 如果将来某个宿主线让 profile patch 行经多锚点解析（profile + 安装兜底），这条符号链接可以整个摘掉、pin 随之退役——每次官方 loader 发布后值得复查一次。
