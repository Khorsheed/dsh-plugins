# Agent Note：恢复尚未完成导航的 iOS WebView

Status: implemented

## Problem

真机 App 可能停留在 about:blank，仅显示原生连接栏。该设备重新导航时返回 HTTP 401；拒绝响应后，WebKit 又产生策略错误，覆盖了可操作的登录说明。两个“重新载入”按钮都会清除错误并调用 WKWebView.reload()，但该方法不能把未完成导航的空白页带到配置的 Host。

## Decision

统一使用 BrowserState 的重载操作：已有同源文档时刷新，否则明确加载配置的登录链接。策略取消回调保留登录拒绝的提示。原生导航最多等待 30 秒，超时显示恢复操作；完成、失败、视图卸载或 WebContent 终止时取消计时。DEBUG 生命周期诊断不包含 URL、token 或 Cookie。

## Alternatives considered

反复重启 Host 无法修复原生重试动作。自动清除全部网站数据会丢掉仍可用的登录及其他 App 偏好。无条件重载循环可能持续重试已过期的登录，却不给用户替换入口。

## Consequences

此修复需要更新原生 App，不修改 Host 源码。真正失效或缺失的官方登录仍需有效会话；修复不会绕过鉴权或签发凭据。原生导航时限与随后插件、大会话的加载耗时是不同阶段。真机证据和剩余检查记录在验收文档中。
