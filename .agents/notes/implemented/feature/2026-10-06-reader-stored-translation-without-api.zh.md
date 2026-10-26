# Agent Note: 没有 Translator API 的浏览器也能查看已保存的译文

Status: implemented

## Problem

灵感空间用浏览器自带的 Translator API 翻译正文，只有桌面版 Chrome 138+ / Edge 148+ 有。iOS 上的浏览器都是 WebKit，没有这个 API，所以手机上地球按钮从不出现——即使这篇文章读者已经在桌面上翻过，而宿主自两层译文存储（全局句子记忆 + 按条目、以正文哈希为键的映射）上线以来一直存着这些句子对。读者问手机上为什么没有翻译按钮；他们想读的译文其实已经在磁盘上。

## Decision

- **没有 API、但存有这篇正文的映射 → 地球出现，只能查看。** `detectTranslator()` 为 null 时，打开文章会向宿主要这一条自己的映射（`getEntryTranslation`）。只有 `bodyHash` 等于 `translationHash(articleHtml)` 且至少有一段的记录才会点亮地球（`ReaderPane.tsx` 里的 `storedPair`）。没有这样的记录，地球照旧不出现。
- **点亮只是贴上，从不翻译。** `showStoredTranslation` 对正文分段，用桌面翻译同一个 `warmMemory` 预热页面记忆（先条目映射，其余句子查全局记忆），再用 `applyRemembered` 贴上——它是 `runTranslation` 只靠记忆的第一步，现在从 `translate.ts` 里拆了出来。两层都没覆盖的句子保持原文。若与分段一个都对不上，地球再次消失。
- **语言对用记录自带的。** 这条路径不需要语言检测：存下的记录写明了它是在哪个 `<源>→<目标>` 下产生的，就用它读记忆。
- **三档视图可用，不提供重新翻译。** 下拉菜单抬头显示 `translate.stored`（「已保存的译文 · 中文（简体）」）而不是 `translate.local`，没有翻译器时隐藏「重新翻译」。阅读只回写 LRU 时间戳（`rememberSentences` 的 `entries` 为空，读到的句子对放在 `recalled`）。
- **重新挂载后的恢复不需要会话。** 「把地球重新点亮」的那个 effect 在桌面上要求本页已建好翻译会话（`Translator.create()` 需要手势）；没有 API 时改为接受存下的语言对。
- **整墙翻译仍只在桌面上有。** 墙上的卡片逐字段翻译，没有按墙落盘的东西可供查看。

## Alternatives considered

**手机上走宿主 LLM 翻译。** 能让每篇文章都可翻，但要把文章发给模型服务，一篇长文花几万 token——正是端上翻译设计当初拒绝的取舍。留给用户另行决定。
**全局句子记忆覆盖了部分句子就显示地球。** 记忆跨文章共享，可能覆盖一篇没人翻过的文章里零星几句；点亮一张半译的页面比不显示更糟。只有以这篇正文为键的条目映射才能证明这篇翻过。
**依赖 Safari 自带的网页翻译。** 不用写代码，但它翻的是整页外壳，且未在面板 DOM 上验证过；它是之后再测的手动退路，不是设计本身。

## Consequences

- 手机现在能读桌面上翻过的内容，不花钱、不经模型。桌面上没翻过、或之后重抓过（正文哈希变了）的文章，手机上仍然没有地球。
- 在没有 API 的浏览器上打开文章要多一次 `getEntryTranslation` 读取。桌面路径上本来就有这次读取，这里只是提前到打开时。
- `runTranslation` 与查看存档路径共用一个贴记忆的函数，改动「记住的句子如何贴上」会同时作用于两边。
- Safari 是否成为正式支持的阅读面，推迟到与用户一起测试后再定。

## Testing

`packages/reader` 共 461 个测试（新增 3 个，`tests/ReaderPane.client.spec.tsx` 的「the translation memory survives a reload」组）：

- 无 Translator API + 存有与正文匹配的映射 → 地球出现、译文贴上，菜单显示存档抬头且没有重新翻译，「只看原文」能切回，阅读回写 0 条新句、3 条 recalled；
- 无 Translator API + 什么都没存 → 没有地球；
- 无 Translator API + 存的是旧正文的映射（即使全局记忆里每句都有）→ 没有地球。
