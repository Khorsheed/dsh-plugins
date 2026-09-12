# Mobile Safari compatibility 验收 — 2026-09-12

验收人：Codex · 插件：mobile 0.1.0 开发线 · 宿主：0.1.5-rc.1 / 183f08e9c6

## 环境

现有 3080 提供只读会话数据，使用独立 Playwright WebKit 26.5 浏览器上下文。仅该测试上下文通过路由装载候选移动端 bundle，并调用生产兼容 helper 适配官方脚本；未向用户会话发送消息，未修改宿主源码、生产文件或重启服务。

另外，在独立 WebKit 页中加载该宿主的 JSON helper、Assistant stream 展开函数和客户端 fold。校验函数采用实际发布脚本中命中指纹的完整函数。其余源码只做 TypeScript 转译与隔离，不修改逻辑，输入为合成 raw block-start + text-chunks 基线和后续 chunk。

## 逐项结果

| 项 | 判据 | 结果 | 证据 |
|---|---|---|---|
| 包级构建 | tsc + tsdown | 通过 | mobile build |
| 包级回归 | 官方服务调用、布局、入口转发与补丁边界 | 通过 | 19 文件，72 测试 |
| 完整函数匹配 | 组合 bundle 多副本及缩进/名称后缀 | 通过 | 实际组合脚本命中 2 处 |
| 误匹配保护 | 未知函数、混合新旧候选、已修复版本 | 通过 | 未知原样返回；重复适配 no-op |
| 原型约束 | 当前 realm、跨 realm、伪造/自定义原型 | 通过 | 未改全局 Function.prototype.toString |
| HTTP 边界 | 原认证、JS 字节长度、旧 ETag/条件范围请求、超大脚本、非 JS、编码响应 | 通过 | ingress HTTP 测试 |
| 流式透传 | 非脚本流首块立即送达、拒绝的 WebSocket 仍拒绝 | 通过 | 既有 ingress 回归 |
| WebKit 确定性复现 | 原版 raw chunk 基线展开 | 复现 | `Assistant stream raw chunk must be a lossless JSON object` |
| WebKit 兼容后 fold | 基线恢复、后续 chunk、再次恢复并继续 | 通过 | 3 条恢复项，正文 `restored`，后续 ` continued`；再次恢复同样成功 |
| 独立 WebKit 读取真实任务 | 正文不再停在旧 seq 435 | 通过 | 先读取至 seq 1735，后一次读取至 1770，Session open / error null |
| 主动重连 | 正文 journal 更新 generation，不产生旧校验异常 | 通过 | generation 1 → 2，pageerror 为空，window.scrollY 为 0 |

真实任务的观察窗口内处于工具执行阶段，未观察到逐字输出；DOM 字符数的少量变化可能来自运行计时，不能拿来当作 token 流增长证据。进行中基线恢复与后续文字由独立 WebKit 确定性用例验证。实际 iPhone 上线后仍需一次前后台切换验收。

## 部署前状态

- 首轮检查时 3080 仍有用户任务运行，因此未重启。后续只读会话列表检查确认 400 个会话没有运行项，后台作业为空。
- 首轮 gate 的部署脚本自测遇到默认 5000ms 超时；独立 12 项测试通过。同步主分支已有的集成测试时限/扫描修复后，重新运行全部 11 项 scoped gate，通过（62 秒），mobile 19 文件 72 测试。Docker daemon 未启动，既有 Docker 集成套件明确跳过；未声称覆盖该环境。
- 未完成生产 tarball、入口启用 `MOBILE_SAFARI_COMPAT=1` 和手机重载验收。这些需在用户任务和后台作业结束后与之前的移动端改动一同执行。
