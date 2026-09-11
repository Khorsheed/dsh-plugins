# mobile Quick Tunnel 验收 — 2026-09-11

## 环境

独立 `feat/mobile-rc1` worktree；官方 Host `0.1.5-rc.1` / `183f08e9c6`，mobile 开发版 `0.1.0`。沿用 [rc1 验收](mobile-rc1-2026-09-11.md) 的隔离 profile、工作区与官方模拟模型；没有使用真实模型凭据，没有修改主工作区、官方或兄弟源码，没有部署生产 3080。

链路：手机/浏览器 → Cloudflare 临时 HTTPS → cloudflared（HTTP/2）→ loopback 3182 独立入口示例 → loopback 3181 Host。模拟模型端口 3199。Node 22.21.1、cloudflared 2026.8.2；隧道注册成功，节点 sjc11。本轮未登录 Cloudflare 账号，没有使用自有域名或服务器；不据此推断手机所在网络一定可达。

示例源码位于 `packages/mobile/examples/https-ingress.mjs`，由部署者单独启动，不在 Cordis 插件加载时启动。公网 authority 同时配置于示例的 `PUBLIC_ORIGIN` 和官方 `--trusted-host`。临时地址、启动凭据、Cookie、日志均只保存在忽略的 `.dev/` 中，不随社区包发布。

## 逐项结果

| 项 | 结果 | 证据与范围 |
|---|---|---|
| 外网入口 | 通过 | 实际公网 HTTPS 请求可达，未通过 localhost 替代公网测试 |
| 未认证 HTTP | 通过 | `/`、`/api/mobile/handshake`、POST `/api/session/uploadFileBinary`、普通 GET `/api/remote.mux` 返回 401 |
| 官方登录 | 通过 | 启动 token 交换后页面 200，跳转干净的 `/`，1 个官方 Cookie 且带 Secure；未读取私有密钥 |
| 认证握手 | 通过 | 公网 `/api/mobile/handshake` 返回 200、bridgeVersion=1，配对和推送仍为 false |
| 认证 WS 升级 | 通过 | 实际公网 HTTPS Upgrade `/api/remote.mux` 返回 101 |
| 跨 Origin 升级 | 通过 | 携带有效 Cookie 但 foreign Origin 返回 403 |
| 未认证 WS 升级 | 拒绝，但状态异常 | 公网 Upgrade 返回 500，未返回 101；不得记作 401，状态码来源尚未定位 |
| 公网浏览器页面 | 部分通过 | 内置浏览器可见官方会话树、输入框、模型/权限控件和内测声明；此后 UI 自动化多次超时，无法完成整轮公网流式交互 |
| 插件构建与测试 | 通过 | 4 文件、15 tests：含入口保留 Host/登录 Cookie、拒绝 Host/Origin/协议、保留 HTTP 401、增量 HTTP 转发和 WS 拒绝 |

本地浏览器的模拟回答流式与保留草稿重连已由前一份记录验证；不能合并为公网或真机已通过。临时预览提供给用户在 Safari 查看效果，界面运行来自电脑，回答来自模拟模型。

## 卡住的地方

- 公网 WS 未认证请求确实被拒，但为 500；仍需定位官方升级拒绝与隧道之间的状态码传递，不承诺完整认证矩阵验收。
- 浏览器自动化在公网加载后持续超时，公网下的增量回答、停止、保留草稿重连尚未完整验证。
- 真机 Safari/WKWebView、签名安装、蜂窝可达性、附件、切网恢复、后台挂起与兄弟插件组合仍待验收。
- Quick Tunnel 没有可用性保证，地址可能随进程重建改变，不支持 SSE；rc1 会话为 WebSocket，不能推断所有插件传输都适用。Mac 唤醒、Host/入口/隧道进程在线仍是前提。
- 示例不提供托管中继、设备配对或逐设备撤销。停止隧道关闭此公网路径；仅卸载插件不撤销官方登录，也不关闭外部隧道。
