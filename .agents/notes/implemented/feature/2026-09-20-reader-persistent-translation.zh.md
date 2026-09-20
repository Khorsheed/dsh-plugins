# Agent Note：读者的译文落盘

Status: implemented

## Problem

读者的主人读的主要是长文，而每次页面重载都会清空全部三层客户端翻译状态——句子记忆、翻译会话、地球记录——于是重载一次就重新付一遍模型。三层里有两层活不下来（`Translator` 会话需要用户手势才能建；地球记录没有会话可驱动就是死的），但句子记忆只是字符串，字符串可以落盘。

这是一次刻意的**决定反转**，2026-09-20 由用户批准了下方设计。被反转的决定——「译文不离开页面」——横跨四份 note 建立：[重写 note](../feature/2026-09-17-reader-rewrite.md)（本次复用的持久化缝由它拥有）、[端上翻译 note](../feature/2026-09-18-reader-on-device-translation.md)（它那条被拒绝的「缓存译文」备选由本次取代）、[会话记忆 note](../feature/2026-09-19-reader-session-memory.md) 与[状态边界 note](../architecture/2026-09-19-reader-state-boundaries.md)（它的边界规则把译文文本放进了绝不落盘的浏览器记忆）。让这次反转安全的东西：当年的隐私论据从来是关于**网络**而不是磁盘——落在宿主 state 目录里的译文，是读者读过的页面的派生内容，与旁边的缓存正文同一敏感级；而那条规则防的失败（落盘的地球记录在重载后没有会话可驱动）与此正交——会话与地球记录照旧不落盘，地球照旧等读者那一下手势。

## Decision

宿主侧两层，复用 store 现有机制（`store.ts` 的 sidecar 文件、原子提交、`pruneBodies`），外加一个写穿透的页面镜像：

- **全局句子记忆**（`translationMemory`）：表住在一个命名文件里（`bodies/translation-memory.json`）；文档只带 manifest（`version`、`file`、`entries`、`chars`、`updatedAt`）——文档每次提交都整体重写，一张 5 万句的表不能搭 `recordRead` 的车。键是 `<src>→<tgt>:<句子哈希>`——语言对在键里，顺带了结页面记忆按裸句子分键的旧账。值带原文、译文、`lastUsedAt`；上限 50 000 条，LRU 淘汰。
- **按条目的译文**（`annotations[entryId].translation`）：`{ version, pair, bodyHash, segments, translatedAt, lastUsedAt }`——哈希到译文的**映射**，绝不是译文标记。正文小幅重抓只作废这份精确匹配的映射（`bodyHash` 不符），没变的句子仍由全局层命中。大映射走与正文同一个 `writeBody`/`bodies/` 机制，`pruneBodies` 连带清扫它们的孤儿（连同记忆文件）。
- **一个共享预算，没有 TTL**：`cache.translationBudgetChars`（默认 64 MB 字符量，随现有 `getCachePolicy`/`setCachePolicy` 读写）。译文刻意不继承正文的 24 小时 TTL——重建一份要一次手势加逐句模型。`boundTranslations`（`store.ts` 里的纯函数）按 `lastUsedAt` 跨两层**统一** LRU 淘汰，schema 版本不符者见到即淘汰。读从不重写文件：LRU 时间戳由运行报告复用了什么（批量 `recalled` 清单）推进，而不是在哈希被问及时。
- **两层都带 schema 版本**（`TRANSLATION_STORAGE_VERSION`）：浏览器 Translator 模型升级或这里的切句变化时 bump，旧记录全部读作 MISS，由下一次写入或预算巡查惰性淘汰——绝不主动清空。
- **三个 Remote 动词，刻意最少**：`getEntryTranslation(entryId)`（精确映射，宿主侧解析 sidecar）、`getSentenceTranslations(pair, hashes)`（切片——客户端自己算正文句子的哈希，整表永不过线）、`rememberSentences(pair, entries, recalled, entryId?, bodyHash?)`（一次运行一批写：learned 落库、recalled 续命、条目映射按本次运行的全句集重写；文件先于文档，`storeRaw` 的顺序）。
- **客户端**：`translate.ts` 的 `MEMORY` 现在按语言对分键，并且是写穿透**镜像**——`runTranslation`/`translateTexts` 返回 `learned`/`recalled` 两份清单，面板按运行一次写回（运行就是批的边界；不存在按句写入）。`startTranslation` 在花模型之前先热记忆——条目映射优先（pair + `bodyHash` 双闸），再为没盖到的句子要全局切片；整墙翻译按语言组同样先热。会话、地球记录、恢复编排都不变：重载后地球是灭的，等读者点一下，然后正文从磁盘重绘，模型不沾。

## Alternatives considered

**走 `sessionStorage`/`localStorage` 而不是宿主。** 早期 note 拒绝「记录（视图 + 源语言）落盘」的理由依然成立——记录留在页面记忆里；而对句子文本，浏览器存储会把记忆按浏览器、按标签页生命周期搁浅——宿主 state 目录本来就是缓存正文在的地方，而读者是一个部署读一面墙。
**两层都内联进 `state.json`。** 文档每次提交都整体读写，开一篇文章就有一次提交；几 MB 的记忆表会让每个读者手势都付这笔税。manifest + sidecar 的拆法正是正文存储已经给出的答案。
**按条目存译文 HTML。** 一次重抓就作废几 MB 标记；段落映射以句子粒度扛住小编辑，而 DOM 反正都是从存下的正文重建的。
**切片读时刷新 `lastUsedAt`。** 那会让每次热记忆都变成一次整文件重写；批量 recall 报告以每次运行一次写入推进同样的时间戳。
**按语言对分文件。** 文件更多、内容一样；带语言对前缀的键已经给一张表分了命名空间，而一个文件让预算巡查只读一次。

## Consequences

- 重载之后，文章和位置照旧回来，地球照旧等手势——手势之后，译文是读盘，不是跑模型。
- 面板的页面记忆不再是任何译文唯一的副本；`primeMemory` 绝不覆盖页面里较新的写入。
- `boundAnnotations` 与 `cleanupAnnotations` 现在把译文（以及顺手修掉的裸 `fetch` 记录）当作承重内容——正文淘汰或一次标签操作不再把它们带走。
- 隐私故事是重述，不是放弃：模型照旧在设备上跑；落盘的是派生句子对，放在缓存正文旁边，共用一个预算，随同一个目录卸载。
- `dsh.compat.notes` 与两份 README 都带新的落盘故事。

## Testing

`packages/dsh-reader` 共 311 个测试（+21；每个新用例都对着改动前的代码红过——宿主用例对着不存在的动词，客户端用例对着不热的面板/不分键的记忆）：

- `tests/boot.spec.ts`（+6，真 context + 临时目录）：跨重启的语言对分键；条目映射（内联与 sidecar、淘汰连带清扫）；跨层 LRU 淘汰；旧 schema 读作 miss 且不主动清、下一次写入替换；`recalled` 推进使用时钟。
- `tests/annotations.spec.ts`（+6，纯函数）：共享预算跨两层 LRU、旧版本见到即淘汰、数量上限、预算内原样、normalizer 的惰性保留、正文淘汰时 `boundAnnotations` 保住译文。
- `tests/translate.client.spec.ts`（+4）：语言对分键（别的对 miss 且重付）、`learned`/`recalled` 清单、`primeMemory` 热灌语义、哈希稳定。
- `tests/ReaderPane.client.spec.tsx`（+4）：存下的条目映射零模型调用上屏；`bodyHash` 失配跳过映射但全局切片仍作答；一次运行恰好一批写回（pair + entryId + bodyHash）；完整刷新重演——文章从 `sessionStorage` 回来、地球点一下、整篇来自存储、零次新模型调用、recall 批次推进时钟。
