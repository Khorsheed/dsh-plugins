# Agent Note: library + 学习模式家族（M1）——存储、工具与可见性判据

Status: implemented

## Problem

提案 [`2026-10-06-library-learning-mode`](../../../proposals/active/2026-10-06-library-learning-mode.md) 要一个现有包都没有的学习闭环：按项目组织的书、每本书一条 Duolingo 式路线图、由模型维护的词书、以及判题结果反哺前两者的测验。仓库需要拍板：状态放哪、三个模型动词如何覆盖一打候选、一张手写笔记的照片如何变成带出处的词卡、图书馆 tab 对什么可见性判据负责。

## Decision

两个包，各自可独立装卸。

**`@khorsheed/dsh-library`**（packages/library）承载全部：

- **存储**（`src/store.ts`）是 mission store 纪律的移植：`$DSH_HOME/state/dsh-library/` 下放 version-guarded 的 `state.json` 索引，每项目一个目录（`project.json`、`books/<id>/{book.json, chapters/<n>.html}`、`roadmap.json`、append-only 的 `vocab.jsonl` / `attempts.jsonl`、`quizzes/<id>.json`）。变更走项目级手卷锁（排他创建 `.lock`，带 `{pid, at}`，死锁回收）→ 读 → 临时写 → 原子改名；账本是 append-only，唯一特批例外是 `rewriteVocab` 整册换写（同锁下临时写+改名）——掌握度更新改的是既有行。裸 `node:fs`，绝不经 `ctx.fs`（reader 的教训：会话沙箱会拒写 `$DSH_HOME/state`）。
- **service**（`src/service.ts`）独占全部规则：路线图状态机（只有 `locked → current → done`，对既有路线图逐点校验，除非 `regenerate: true`；`current`/`done` 要求依赖全 `done`；chapterRanges 必须落在书的真实章数内）、词书合并（同词同章合并，重录绝不重置掌握度）、**evidence 闸**（quiz 每题缺 `ch:<n>` chapterRef（须指向真实章节）或原文 evidence 即拒收并教正确格式；章节里逐字找不到的引用落盘但进 `warnings`）、**assess 级联**（`putAttempt`：verdict 落 append-only 账 → 被测词卡答对升一档 Leitner box / 答错归 box 0 且明天到期（间隔 1/2/4/7/15 天）→ 被门节点的 quizStats 更新 → 达标（默认 0.8）即完成并解锁后继节点；返回值带 `unlocked` 与 `completed`）。
- **模型面是 `./tool` 组合入口**（`src/tool.ts`），评测家族折叠形态：`inject: ['library']` 让行 pend 到 core 就位（2026-09-27 启动顺序教训），工具/skill/prompt 段走延迟 `ctx.inject` 注册，`config.tools: all|none` 整体开关模型面。三个工具——`library_read`（what ∈ projects/books/toc/chapter/roadmap/vocab/due/quiz/stats）、`library_write`（project/book/roadmap/notes/quiz）、`library_assess`——各自以**内联** `Symbol.for('dsh.tool.origin')` 赋值打 origin 标签：从 capability-catalog 导入 helper 会构成未授权的跨包边（eval 同款内联）。`library` skill 以 `skills/library/SKILL.md` 随包发布、apply 时从磁盘读出（datasets 形态：frontmatter 解析，`files` 覆盖 `skills/**/*.md`），承载逐 what 的 payload 形状与 ch:<n> 约定。
- **照片出处存引用不存字节**：照片来源的词卡带宿主 attachment 的完整持久引用字段（`attachmentId` + mediaType/bytes/width/height）——`attachments.readImage` 按整份引用校验，光有 attachmentId 读不回任何字节。`readAttachmentBase64` 白名单只允许该项目的词书条目实际记录的 attachmentId，缺席降级为错误码：`unavailable`（无 attachments 服务）、`not-found`、`ref-incomplete`。
- **摄入在浏览器半**（宿主没有 DOM parser）：fflate 解 EPUB 的 zip，DOMParser 读 container/OPF/spine/NCX|NAV，白名单消毒（`src/client/sanitize.ts`）剔 script/style/iframe、透明容器解包、属性只留安全 href/src。失败给诚实错误分类（`not-zip`/`not-epub`/`encrypted`/`no-spine`/`no-chapters`）。Markdown 按「命名超过一个对象的最浅标题级」切章。fflate 是本家族唯一新依赖。
- **tab 自隐用 canvas 双查判据**（`src/client/preset-visibility.ts`）：profile 根行 ∪ 当前会话 preset 行里的 `@khorsheed/dsh-library/tool`，一切不可读路径 fail-open，`RegistrationToggle` 注册/注销。判据常量名指本包自己的子路径，所以——与 canvas 的 `@khorsheed/dsh-canvas/agent` 相同——library 包**不声明** `dsh.references`（检查器的 ALLOWED_EDGES 注释记录了缘由：自身子路径常量不需要）。

**`@khorsheed/dsh-bundle-learning`**（packages/bundle-learning）是 `preset-declarations` bundle：一行 `preset-learning`（id `learning`、name 学习模式、order 12），plugins = 官方 standard 基底按场景节食（fs / skills 对 / ask-user / todo / web / compaction——无 shell、goal、plan-mode、delegation、fs-search、jobs、present、agent-instructions）+ `library-tool` 行（`tools: all`）+ 英文单声部的教练 persona。`@khorsheed/dsh-library` 进 `dsh.references`（数据，绝不是 npm 边）；测试照 bundle-writing 钉行集、引号与 references。

**共享层改动**（mainline 授权）：`COMMUNITY_SERVICE_INJECTORS` 加 `library: /^library$/`；`TYPERT_PACKAGES` 加 library；`docs/packages.md` 重新生成。

## Alternatives considered

- **包里带 `skills/` 目录、由 preset 行引用（任务书初稿）**：树内真实机制并非如此——canvas-novel 把 skill 文本内联在 `src/skill.ts` 由 agent 入口注册，datasets 把 `skills/<name>/SKILL.md` 当 payload 随包、apply 时从磁盘读。library 随 datasets（tarball 带真实 SKILL.md），不发明不存在的 profile 侧约定。
- **library 包为可见性常量声明 `dsh.references: ['@khorsheed/dsh-library']`**：弃。常量指本包子路径，canvas 先例不为自己的 `./agent` 声明任何东西；检查器对自名跳过。引用由 bundle 包承担——跨包名真正出现的地方是那里。
- **evidence 对章节做硬性子串校验**：提案的防幻觉意图由「存在 + 章节存在」硬拒与「非逐字引用」落盘告警共同承担——合理缩写式引用太常见，硬拒只会教模型注水引用而非真实引用。
- **章节按语义块分页**：v0.1 不做。100KB 字符预算在闭合标签处截断是可预期可测的；语义分块随精读 tab 一起再来。

## Consequences

- **门禁**：全量 `pnpm run build` 绿；library 60 测试 + bundle-learning 7 测试绿；`check:plugins` 含两个新包扫描干净；`test:scripts` 绿。boot 测试证明了纯测试看不见的接线（ctx.provide + Remote 挂载；tool 行的延迟注册；`tools: none` 零注册；core 缺席时记日志而非抛错）。
- **延后（提案自己的 M2/M3 范围，代码里以缺席形态可见）**：conversation.view 精读 tab 与交互答题卡（出题判题走会话消息流）、URL 摄入（reader/capture 缝）、PDF、iOS 验收、datasets 互通。`readAttachmentBase64` 需要条目带完整图片引用——skill 教模型从消息的 image block 抄全，提案的 P0-2 探针仍欠真实路由的验证。
- **未部署**：两个包都没上 3080 或 npm；版本即各自首行（0.1.0）。

## Testing

`packages/library/tests/`：store.spec.ts（索引 guard、原子写、append-only 账本、锁）、service.spec.ts（CRUD、分页、状态机、合并、evidence 闸、级联——含 box-0-明天到期与达标解锁）、tool.spec.ts（what 枚举教学、闸穿透工具、skill 加载）、ingest-md.spec.ts（切层级、渲染器）、ingest-epub.spec.ts（测试内现场 zip 最小 EPUB、错误分类、消毒器）、boot.spec.ts（真实 cordis Context 启动）。

## Related

- 提案：[2026-10-06-library-learning-mode](../../../proposals/active/2026-10-06-library-learning-mode.md)
- 可见性约定：[docs/plugin-visibility.md](../../../docs/plugin-visibility.md)（canvas 双查、fail-open）
- 折叠先例：评测家族 `./tool` 入口（T88）、canvas-novel 的 `./agent`。

## 评审 delta（2026-10-06）

五条评审 delta 落在首版之上，同属 0.1.0：

- **书架改为卡片网格。** 项目视图的书籍从列表行改成自适应卡阵（`repeat(auto-fill, minmax(148px, 1fr))`——宽栏三列、窄栏两列，不写死断点）：封面块、书名、作者、`章节 done/total` 进度（done 节点覆盖的章节数）；虚线「添加书籍」卡同格，指到同一个文件输入。
- **书已解析但无路线图时给 CTA 而非空提示。** 书籍视图显示火花卡（「还没有学习路线…随时可重排」）+ 主按钮「生成学习路线」——与重新拆书同一个会话草稿手势，文案为首拆措辞。
- **节点带 kind：quiz | read。** 拆书即分类：要学习者作答的内容进 quiz 节点（判题达标才完成）；导读、全书结构、前言、附录进 read 节点——绝不带 quizStats（store 归一会剔，service 拒写），读完即完成：当前 read 节点带「读完」按钮，经 `putRoadmap` 翻 current → done。状态机边不变；`putRoadmap` 现在级联解锁（done 节点的后继转 current)——read 翻转欠后继的解锁，与 assess 欠 quiz 完成的是同一笔。存量无 kind 的路线图读回即 quiz 节点。
- **出题范围收窄到 quiz 类章节。** 有路线图时，`putQuiz` 拒收落在 read 节点章节（或无主章节）的题目，报文点明合法集合；`scope.node` 指向 read 节点同样拒收。没有路线图时仍是书级 evidence 闸（先有题后有路线的流程存在）。
- **每个项目一本 append-only 审计账。** `events.jsonl`（与其余账本同锁同原子纪律）记录 book.ingested / roadmap.generated / roadmap.regenerated / notes.recorded / quiz.created / attempt.assessed / node.completed / node.unlocked，每条 `{ at, type, …摘要 }`，对象标题去规范化随行，读者免 join。`listEvents(projectId, limit?)` 倒序回答；书籍视图底部「动态」区渲染最近 20 条（图标 + 一句话 + 相对时间）。

测试新增：read 节点免考流转与其级联解锁；出题范围拒收（read 章节、read scope、合法放行）；审计账的发射与倒序读取（含「读完」翻转的事件）。library 套件 66 测试全绿。

## client bundle 漏 node:module 修复

3471 验收实例（`~/.dsh-lab/profiles/library-test`,link: 安装）web boot 挂在 `require("module") missed the module table`。根因：**tsdown 对 CJS 格式的 bundle 强制 `platform: 'node'`**(tsdown build 里 `platform: cjsDts || format === "cjs" ? "node" : platform`)，而 client 包就是 CJS(loader 包装）。该平台下 fflate 的 `node` 出口条件胜出，打进去的是 `esm/index.mjs`(node 构建，用 `createRequire('/')` 探测 worker_threads）而非 `esm/browser.js`。修在消费处而非共享层：`ingest-epub.ts` 是浏览器专属代码，改为显式引 `fflate/browser`(fflate 自带 `./browser` 子路径；纯 JS,vitest 在 node 下同解——已回环验证）。仓里没有第二个包的依赖存在 node/browser 条件分叉，共享 `clientBundle` helper 不动；出现第二个消费者时，由 helper 给 client 配置透传 `resolve.conditionNames`。测试钉住该 import 写法，防未来改回裸写法。验证：`lib/client.js` 仅剩的裸 require 是 `react` / `react/jsx-runtime`（平台种子词）;12 个内建名加 `node:*` 形式全部 grep 为零。
