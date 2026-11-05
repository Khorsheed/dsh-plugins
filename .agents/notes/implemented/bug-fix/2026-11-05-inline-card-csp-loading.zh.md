# Agent Note: 内联卡片把 CSP 留在 head 并显示挂载状态

Status: implemented

## Problem

以 skill 推荐的 CSP meta 开头的卡片片段虽然能正常渲染，Chromium 却报告位于 document head 外的 CSP 已被忽略。片段包装器把作者写的 meta 放进了 body，而插件自己注入 head 的策略仍在保护 iframe。另一个问题是，React 重建已落定的 Markdown 块时会替换卡片 iframe，中间没有任何过渡界面，直到新文档加载完成前都只留下空白区域。

## Decision

`buildCardSrcDoc` 在包装或标注源码前提取作者写的 CSP meta，并把它们放进最终文档的 head。作者策略（包括多个策略）原样保留；只有未声明策略时才补严格卡片策略。转换仍走字符串处理，避免为了解析不可信卡片而在宿主文档里预加载子资源。

对话渲染器把每个 iframe 挂进自己拥有的容器，并在父页一侧显示加载状态。状态立即出现；只有已加载 srcdoc 里的注入桥脚本发回 `ready` 后才显示画面。停滞十秒后状态改为错误提示和重试操作。重试会重新加载同一份生成的 srcdoc。dispose 与 orphan 回收会一并清理整个容器、计时器和监听器。

## Alternatives considered

- **保留作者 CSP meta 的原位置。** 否决：浏览器只在 head 内执行 meta 策略；即使注入策略已经保护 iframe，被忽略的重复 meta 仍会持续产生警告。
- **用父页 DOMParser 解析卡片。** 否决：惰性解析的文档仍可能发起子资源加载。不能为了修 meta 位置而给不可信 HTML 增加一条宿主机网络路径。
- **把 iframe 的 load 事件当作就绪。** 在 Chromium 验收中否决：初始 about:blank 也会触发 load，父页无法可靠地区分它与不透明源 srcdoc 的 load。文档内显式 `ready` 才指明真实边界；计时器只负责停滞后的兜底。
- **用固定延时遮住空白。** 否决：小型内联文档与大型脚本卡片没有可靠的统一延时。
- **把加载提示注入卡片文档。** 否决：内联脚本可能在 iframe 首次绘制前就开始执行，文档内提示覆盖不了这段空白。父页界面也不受作者样式和脚本影响。

## Consequences

- 符合 skill 的片段卡片不再产生 head 外 CSP 警告，自定义 CSP 文档也保留原有策略语义。
- 重新挂载时显示明确加载状态而非空白；停滞的 iframe 现在提供重试，不再只留下无法解释的空区域。
- 兜底不保存 React 重挂载前后的卡片状态，这一现有限制不变。
- 与 processed 代码块配对的渲染器自有兄弟节点从裸 iframe 改为容器。

## Testing

srcdoc 套件钉住片段与完整文档的 CSP 只出现在 head 且不丢失作者内容；渲染器套件钉住忽略初始 load、显式就绪、超时、重试和销毁。Chromium 验收使用原 session 片段，确认 head 外 CSP 警告与 page error 均为零、章节/列表交互可用、高度上报为 729px、重挂载始终只有一个自有容器，以及真实十秒停滞后能重试成功。
