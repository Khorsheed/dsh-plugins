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

## 生产切换结果

- 用户批准切换失败时恢复原启动配置。操作前只读检查确认 400 个会话无运行项，后台作业为空。
- 原临时公网隧道已经停止。新 authority 同步配置到安装 tarball 的 ingress 与 Host trusted-host；未修改 Host 源码。
- 第一次隔离检查拒绝了已删除 worktree 遗留的依赖链接。备份路径/目标后清理 96 个确认失效的生成链接，再通过官方 CLI 重建 profile fallback；`deploy:check-links` 通过。候选命令改为分别执行无 app 参数的 config dump 与完整 Web argv 的 help 检查，继承 guard 提供的隔离 DSH_HOME。
- `reconfigure` 的 candidate probe、composition preflight 均通过；built runner、安装锚点与目标 command SHA 已绑定。旧 supervisor/child/listener 身份被复核，新 listener 保持 3 秒稳定、retry 0，登录交换 303 → 已认证根页 200，canary PASS。原浏览器标签页完成 authenticated ACK，回执 ready，未触发恢复。
- 公网验收发现 identity UI bundle 达 12,297,632 字节。追加 gzip 协商输出后变为 4,200,323 字节；含两处补丁的 2,052,822 字节 bundle 变为 415,634 字节。编码拒绝、解压后字节一致性与缓存头回归通过；mobile 合计 19 文件 74 项测试，完整 11 项 scoped gate 通过。
- 第二次 tarball 安装使用 `--no-restart` 时，运行中的 Host 仍保留旧 client 文件路径，新开页面卡在插件加载。因此随后走标准带重启的 `deploy:3080 --package packages/mobile`，构建、74 项测试、preflight、watchdog canary 全通过。仅重开 ingress 不足以完成此 Host 的 tarball 替换；`--no-restart` 必须视为待维护状态，不可作为在线热更新完成。
- 手机已安装前序原生布局修复，并成功启动到新 HTTPS authority。公网 WebKit 确认脚本头命中两处已知兼容补丁。最终正文对照与手机手动前后台体验见后续补记。

## 公网故障现场补记

- 手机截图显示页面已加载、连接停在 connecting、列表 pending。实际安装 ingress 的脚本通过本地 WebKit 读取同一会话成功，重载前后正文尾部哈希相同，无 pageerror；Chromium 本地读取同样成功。跨引擎全文哈希不同，不宣称两端逐字相同。
- 公网首页在 HTTP/1.1、HTTP/2 请求中均超时；本地入口同请求正常。cloudflared 的 QUIC 注册仍在线，但运行栈中 122 个请求流等待解析连接数据，并未进入本地 HTTP 入口。此时注册状态不能作为可用性证据。
- 独立 HTTP/2 隧道的公网请求在约 1.6 秒到达入口，收到预期的未列入允许域名的 403。该结果只证明新链路可达，尚不代表认证或会话恢复已完成。
- 切换前发现 Web 会话重新开始运行，暂停重启，等待任务完成或用户明确同意中断。
