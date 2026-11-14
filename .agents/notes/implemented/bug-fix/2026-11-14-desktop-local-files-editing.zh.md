# Agent Note: desktop 文件编辑把打包应用视为本机页面

Status: implemented

## Problem

`local-files` 已经有文本编辑、原子 `writeFile` Remote 和冲突保护。desktop 不显示编辑按钮，是因为 `WorkspaceView` 只在 `browserOnHost()` 为真时提供 `onSave`。这个判断原来只认 loopback 主机名，但打包桌面页面的地址是 `dsh-app://app/`，于是 desktop 被当成远程浏览器，保存手势被隐藏了。

这是宿主判定错误，不是编辑器没实现、文件系统限制或漏发布。远程页面只读是有意设计，必须保持不变。

## Decision

`browserOnHost()` 把 `dsh-app:` 且主机名为 `app` 的页面视为本机文档。loopback 地址和原有的无法读取位置时的回退逻辑不变。其他来源，包括 desktop 更新壳页面和远程隧道，不提升为本机访问。

desktop 因此获得与 loopback Web 相同的完整文本编辑器。`localFiles.writeFile`、冲突处理和远程只读行为都不变，不新增写入通道。

## Alternatives considered

- **所有来源都允许保存。** 否决：原有本机边界刻意让远程浏览器只读。
- **绕过启动参数。** 否决：缺少编辑器是因为 UI 隐藏了 `onSave`，不是 CLI 发现或写入路径有问题。
- **接受所有 `dsh-app` 主机名。** 否决：只有打包应用的工作区文档需要编辑权限，更新壳页面不需要。

## Consequences

desktop 用户可以通过原有 Remote 编辑并保存完整的文本文件。远程浏览器仍然只读，不增加新的凭证或宿主版本要求。灵感空间的空状态也把原有新增动作改成居中卡片，明确显示「新增灵感」；弹窗仍按面板居中，定位方式不变。

## Testing

`packages/client-ui-panel-kit/tests/host.client.spec.ts` 覆盖打包应用、loopback、远程来源和更新壳页面。`packages/local-files/tests/workspace-view.client.spec.tsx` 在 `dsh-app://app/` 下渲染 JSON 文本文件，确认编辑入口出现。这两组 21 项 panel-kit 测试和 20 项 workspace 测试均通过。

## Related

- [面板设计](../../../../docs/panel-design.md)——本机专属动作与面板内弹层定位。
