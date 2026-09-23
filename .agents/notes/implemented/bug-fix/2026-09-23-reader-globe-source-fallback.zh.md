# Agent Note: The reader's globe survives a misdetected source language (candidate chain + script-evidence veto)

Status: implemented

## Problem

详情页的翻译地球仪会在一些文章上消失——在华人团队的 arXiv 论文上稳定复现。地球的显隐门（`packages/dsh-reader/src/client/ReaderPane.tsx` 的 `translationOffered`）在两种情况下藏起控件：落定的源语言是目标语言（`zh`），或可用性探测回答 `unavailable`。而源语言此前由浏览器 LanguageDetector 对去标签正文的前 600 字符样本判定（`src/client/translate.ts` 的 `detectSourceLanguage`）。arXiv 链接会被升级为 LaTeXML 的 HTML 版（`src/arxiv.ts`），其正文开头固定是标题加完整作者块——一篇约 200 个拼音名字的论文，这 600 字符样本是拼音而非散文，探测器可能高置信地回答 `zh`（或 `vi` 等本机不支持的语言）。回答 `zh` 会直接触发门上的源语言条件；其他错误答案则拿一个本机没有的语言对去探测，落定 `unavailable`。两条路都把地球藏在一篇本来能翻的正文上。

有两个加重因素。探测只问单一源语言，而 `startTranslation` 建 session 时早就走 `[检测值, 'en']` 候选链——门比它把守的翻译器更严格。另外 `translationSource` 和 `translateAvailability` 跨条目存续，上一篇文章的答案会在切换瞬间短暂决定下一篇的控件。

## Decision

探测器降级为提示，脚本测量是否决权，探测走与翻译器相同的候选链。在 `ReaderPane.tsx` 中：

- **脚本证据否决。** `isCjk(articleHtml)` 测量整篇正文。当探测器答案的主标签是 `zh` 而脚本猜测不是中文时，该答案不被信任、以脚本猜测为准——拼音作者块不是中文正文。探测 effect 的提前退出随之简化为 `translationSource === TRANSLATION_TARGET`，该条件现在蕴含「实测为中文正文」。
- **源语言候选链。** 可用性探测按去重后的 `[检测值, 脚本猜测]` 逐个尝试，每个源语言对遍 `TARGET_CANDIDATES` 的所有拼写，落定第一个非 `unavailable` 的答案。只有「所有候选都不可用」才藏地球——与 `startTranslation` 建 session 的链相同，门不再比翻译器严格。
- **按条目重置。** 检测 effect 在切换时同步把 `translationSource` 重置为新正文的脚本猜测（探测器随后异步修正），正文生命周期 effect 把 `translateAvailability` 重置为 `null`，上一条目的答案既不会显示也不会隐藏一个它从未被问过的正文上的地球。

## Alternatives considered

**修取样而不是修门**（跳过作者块；取摘要或第一个长段落；多窗口投票）。否决：那是按站点结构堆规则，每种前置元信息都要新规则，而且只能降低误判率。候选链一次让所有站点的误判无害，包括短文本和多语混排页面。

**干脆弃用 LanguageDetector，永远按脚本猜测翻译。** 否决：脚本测试分不清德语和英语，而非目标语言的错误源会让 `Translator.create()` 以一个不指明语言的错误拒绝——探测器值得保留为第一候选，只是不再是最终裁决。

**只修门，保留跨条目的陈旧状态。** 否决：候选链就位后，陈旧窗口的残留代价是一帧错误控件，而重置只是已拥有这些生命周期的 effect 里的两行。

## Consequences

所得：地球不再因拼音作者块的 arXiv 论文而消失，也不再因任何前缀样本骗过探测器的正文而消失。误判但可用的语言对（探测说 `de`、实际英文、本机有 `de → zh`）行为与之前完全一致——这个取舍早已被 `startTranslation` 的链接受。门与翻译器现在共用同一候选链惯例，与既有「availability() 只是提示，真建一次才算数」的哲学一致。

所费：探测器与脚本猜测不一致时，每篇打开的文章最多两次可用性往返；否决只在一个方向上覆盖探测器，于是一篇 CJK 比例不足 20% 的真实中文正文会被提供一个它并不需要的 `en → zh` 翻译——无害的提供，因为同语言对本来也会藏起地球。

## Testing

`packages/dsh-reader` 现有 424 个测试。面板规格新增了可编程的 `LanguageDetector` 全局与两个用例：对拼音作者名单高置信回答 `zh` 时地球保留、session 以 `en` 建立；检测出的源语言在本机没有语言对（`vi`）时回退到脚本猜测的语言对。两个用例在修复前的代码上均失败（通过把 `ReaderPane.tsx` 还原到 HEAD 做过变异验证）。

## Related

- [The translation follows its body](../../implemented/bug-fix/2026-09-19-reader-translation-follows-its-body.md) — 地球状态往返所经的恢复侧记录。
- [Reader session memory](../../implemented/feature/2026-09-19-reader-session-memory.md) — 恢复路径查询的整页翻译器 session 缓存。
