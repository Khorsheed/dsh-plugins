# Agent Note: Desktop 的浏览器交接 Origin

Status: implemented

## 问题

Desktop 在宿主与实际委派都正常时反复显示连接中断。ankh-guard 的交接接口要求 Origin 是 HTTP(S) 且与 Host 一致，但 Desktop 使用 `dsh-app://app` 提供应用页面，并在转发时删除 Origin。每次轮询因此返回 403，客户端在约 5 秒后把它显示为断线。

## 决策

交接接口识别两种 Desktop 请求形式：`Origin: dsh-app://app` 与未提供 Origin。只有 Host 为 `localhost`、`127.0.0.1` 或 `[::1]` 时，才把它们映射到请求实际的 HTTP(S) Host。根据 socket 是否加密选择 HTTP 或 HTTPS。注册信息与最终进程 URL 使用该本机 Origin，而不是自定义应用协议。

普通 Web 的 Origin 匹配规则不变。`null`、其他应用页面、非本机 Host 和外部 HTTP Origin 继续拒绝。JSON Content-Type、Cookie 认证、capability 哈希、注册匹配和最终确认要求不变。客户端仍负责报告真正的传输故障与已经确认的切换。

这只修改插件，不修改 Desktop 转发或宿主账号服务。

## 考虑过的替代方案

**接受所有缺失或自定义 Origin。** 不采用：这会移除任意部署的来源检查。只接受本机 Host 上的两种 Desktop 形式。

**只接受 `dsh-app://app`。** 不采用：Desktop 转发时会删除 Origin，真实请求仍会失败，因此两种形式都需要支持。

**修改 Desktop 以保留 Origin。** 不采用：交接协议由插件自己负责，可以直接兼容官方转发行为，不需要修改宿主。

**隐藏提示。** 不采用：这会掩盖重启恢复通道的故障，而不是修复它。

## 影响

正常的 Desktop 会话不再把交接请求误报为网络中断，重启恢复可以沿用 Web 的 Origin 与 capability 流程。不引入新凭据或持久状态。非本机 Desktop Host 继续拒绝，不削弱远程 Web 部署的检查。

协议测试覆盖两种允许形式、正确的 launch URL 与认证确认，并覆盖 `null`、其他应用页面、外部 HTTP Origin 和伪造的非本机 Host。伪造 Host 的测试使用原始 HTTP 请求，因为 Fetch 不能可靠地覆盖该请求头。
