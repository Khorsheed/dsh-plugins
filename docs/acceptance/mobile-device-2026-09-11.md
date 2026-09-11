# mobile 真机与会话首页验收 — 2026-09-11

## 环境

独立 `feat/mobile-rc1` worktree；官方 `0.1.5-rc.1` / `183f08e9c6`，mobile 开发版 0.1.0。沿用 [Quick Tunnel 测试实例](mobile-quick-tunnel-2026-09-11.md)：Host 3181、入口 3182、模拟模型 3199、QUIC 临时 HTTPS。未改动生产 3080、主工作区或官方/兄弟源码。

iPhone Air / iOS 26.5.2，USB 配对可用、开发者模式开启。Xcode 使用本机已有 Apple Development 身份与个人团队自动签名；团队/设备标识未写入工程。构建产物在忽略的 `apps/ios/.build-device`，描述文件包含测试设备、允许调试且有效。此次个人开发签名描述文件七天后到期。

## 逐项结果

| 项 | 结果 | 证据与范围 |
|---|---|---|
| 真机构建与签名 | 通过 | device Debug `xcodebuild` 成功，`codesign --verify --deep --strict` 通过 |
| 首次安装 | 被名额限制阻挡，已解决 | iOS 报告免费开发签名名额已满；仅移除用户明确指定的测试 App 后安装成功 |
| 开发者信任 | 用户完成 | 初次 launch 被 iOS 安全校验拒绝；核对有效签名/设备后，用户在手机上完成信任 |
| 真机安装/启动 | 通过 | `devicectl` 安装及启动成功，不据此认定视觉正确 |
| 插件加载 | 用户确认 | 用户在原生连接页看到「移动插件已连接」 |
| 初始新版展示 | 用户截图确认失败，已定位修复 | 输入框移动样式生效，但顶部导航与会话首页缺失；真机日志确认工作区 feed 丢失方法 receiver，触发 shell.overlay 错误边界 |
| 更新后布局诊断 | 通过（状态证据） | 原生收到 mode=auto、active=true、supported=true、navigation=true，root/overlay/main/sidebar 锚点各 1 |
| 修复后渲染诊断 | 通过（DOM 证据） | 真机返回 errors=[]、toolbar=1、library=1；不能替代用户视觉及触控验收 |
| 插件测试 | 通过 | 5 文件、21 tests，包括可见性规则、保留普通 fork、官方导航委托、失败保留页面、可选服务移除、导航期间保留原编辑器与草稿，以及有 receiver 的 feed 读取、归档更新、订阅释放 |
| 原生地址校验 | 通过 | `HostAddress: 20 checks passed` |
| 默认官方 profile + mobile | 通过（产物/服务） | 通过标准 CLI 安装 tarball；HTML 声明的新版本组合资源返回 200，含 mobile library 实现 |

会话首页仅筛选标题与工作区路径，不宣传全文搜索。活动标记取自官方 store，不合成为独立的待办/审批列表。打开会话与新建均交给官方所有者，后台聊天和草稿继续挂载；没有复制发送、编辑、撤回或流式状态机。

## 卡住的地方

- 用户截图明确否定初次展示；修复后已请求再次确认，尚未收到视觉结果。诊断的 active=true 或 DOM 节点存在不等于设计已通过真机验收。
- 当前工具不提供浏览器/原生视觉控制；真机视觉、键盘、安全区、触控与切后台结果需要用户观察，不能用 DOM 单测替代。
- 真机发送、停止、附件、切网、后台恢复和社区插件组合仍待逐项验收。模型仍为模拟数据，不是真实业务模型。
- Quick Tunnel 不支持官方 HMR 使用的 SSE；更新采用受控 Host 重启与 App 重开/页面刷新，不承诺自动热更新。没有修改宿主绕过限制。
- 未发布 npm/IPA/App Store，未启用推送、设备配对或逐设备撤销。提案仍为 in-progress。
