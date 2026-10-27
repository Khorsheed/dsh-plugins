# Agent Note：图片保留页面的显示宽度；去掉微信的捐赠卡片

Status: implemented

## 问题

2026-10-27 报告了两个正文提取问题：

- **logo 大了三倍。** claude.com 的非营利文章用内联样式给机构 logo 定了固定宽度（Best Friends：132×128 的 PNG，`style="width:48.89px"`；推荐语卡片里的 logo 在 `<picture>` 中）。规范化时输出的 `<img>` 都不带尺寸，于是每张图都按原始像素尺寸显示，最宽到栏宽。
- **微信的捐赠卡片混进正文。** mp.weixin.qq.com 对普通抓取返回人机验证，所以阅读器改用无头浏览器渲染页面。页面脚本随后在 `#content_bottom_area` 里填出腾讯公益卡片（「邀请你前往腾讯公益一起捐」、一起捐、捐赠人头像），并在 `#js_tags_preview_toast` 里填出「预览时标签不可点」。两者都在胜出的容器（`.rich_media_area_primary_inner`）里，和 `#js_content` 并列。

## 决定

- **带上内联像素宽度。** 页面的内联样式设了 `width: Npx` 时，普通 `<img>` 和 `<picture>`（取其中的 `<img>`）输出 `width="N"`。百分比、`auto` 和 `max-width` 一律忽略，栏宽的 `max-width: 100%` 仍然生效。`width` 属性不带：它通常就是文件本身的尺寸，带上也不改变显示，而且现有输出逐字节不变。
- **按站点列噪声清单，只用平台自己的稳定 id。** `NOISE_SELECTORS`（`#content_bottom_area`、`#js_tags_preview_toast`）在打分前和需丢弃的标签一起剥掉。每一项都是平台自己的 id。

## 考虑过的其他方案

**在微信上优先用 `#js_content` 作正文根节点。** 暂不采用：标题和头图在它外面，而去掉页面附属内容后，打分已经能找到正确的容器。

**丢掉 class 里带 `logo` 的图片。** 否决：在这一页上，logo 是内容的一部分（说明是谁讲的那段话）。

## 影响

- 已存的正文保持旧的显示，直到重新抓取。
- 第一个 `<source>` 是 `prefers-color-scheme: dark` 变体的 `<picture>`，在两种主题下仍都显示该变体（已有问题）。
