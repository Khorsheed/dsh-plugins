# Agent Note: HTML 渲染分级——M1 通道上限 + M2 Tier0/Tier1 沙箱与能力桥

Status: implemented

[English](2026-08-21-html-render-tiers.md) | 中文

## 问题

文件视图此前只能静态渲染 HTML（`sandbox=""`，脚本永不执行），且超过 512 KiB 的文件根本进不了渲染通道。file-view-html-rendering 提案的 M1/M2 同时补上两个缺口：HTML 专属的更大读取上限，以及显式用户门控后的脚本档——不削弱安全边界（opaque origin、无网络、无宿主访问）。

## 决策

**M1（file-preview，`a4d7883`）**——HTML 走专属读取上限（`htmlMaxReadBytes`，默认 4 MiB），其余文本维持 `maxReadBytes`（512 KiB）；`read` 在文档含 `<script>`、内联事件属性或 `javascript:` URL 时返回 `htmlScripted`——只做默认档位选择与警示的提示，绝不做信任判定。

**M2（ui-file-preview，`e981c25`）**——
- `buildSrcDoc`（html-src-doc.ts）：`srcdoc` 一律内嵌 Tier1 meta CSP——web 壳自身无 CSP，且 `srcdoc` 不是 HTTP 响应，继承不可依赖；片段包装成完整文档，完整文档把 meta 注入其 `<head>`（已有 CSP 绝不重复）。Tier1 额外注入 `content-visibility` 延迟渲染样式与 `dshBridge` 能力桥客户端。
- `attachBridge`（html-bridge.ts）：Tier1 帧的唯一出口——每条 `postMessage` 都校验（`event.source` 必须是受控 iframe、`fn` 在白名单、参数形状检查）后才执行 `openLink`（仅 https、`noopener,noreferrer`）、`copy`（异步剪贴板 + execCommand 回退）、`download`（仅 data:）；错误回回复、绝不在宿主抛异常。
- FilePreviewPane：渲染默认静态；含脚本文档提供「运行脚本」分段，弹出一次性确认；确认后 iframe 切到 `sandbox="allow-scripts"`——**绝不 `allow-same-origin`**，保住 opaque origin（连同 Site Isolation 进程隔离）。10s 看门狗在 iframe 无 load 时提示源码视图或浏览器打开。

## 备选方案

- **总是允许脚本（无确认门）**：否决——脚本正是边界要围住的能力；每次显式手势才是 Tier1 与 Tier0 的区别。
- **`allow-scripts` + `allow-same-origin`（图省事）**：否决——帧可自撕 sandbox 并触达宿主；永不同开。
- **只靠父壳/HTTP 头的 CSP**：否决——壳无 CSP，`srcdoc` 无 HTTP 响应；策略必须进文档。

## 后果

- >512 KiB 的 HTML 现在可渲染而非一票 `too-large`；含脚本文档可在显式门控后运行，边界与静态档相同且多一层 CSP。
- 桥是新增的（小、白名单形状的）攻击面——source 校验 + 函数白名单 + 参数形状；新增能力只能通过扩 `HANDLERS` 并带同样校验。
- 既有 srcdoc 断言随包装更新；新增 7 个单测覆盖包装器、桥、确认门控的 Tier1 流程。
