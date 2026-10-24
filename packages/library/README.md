# @khorsheed/dsh-library

[English](README.en.md) | 中文

手边的书和课程交给教练带着学：书只登记不上传，教练起草路线，拍照记下的划线变成你自己的知识卡片，答错的题订正到会为止。

自学一本教材，以前要自己排进度、自己抄笔记、自己出题，错了也没人记得下次再考。图书馆按「项目」组织学习（比如「数学」「具身智能」）：你登记手上的书，或让教练挑一本现成教材；教练起草学习路线，你点「采用」才生效；读书时拍一页照片，划线和页边批注就记成知识卡片；每站学完做一套章节考，答错的题进「待订正」，订正对了，这个考点就从薄弱变成掌握。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-today.png" width="640" alt="右栏「图书馆」的今日页：继续学习、今日复习（待订正与到期卡片）、项目列表、最近的变化">

## 特性

- **登记书与教材**——书只登记书名、版本、ISBN 和目录，教练联网核对版本与目录（附来源链接），不上传、不解析任何文件。有目录的都算教材：你自己的书、教练挑的现成书或电子课程、教练自编的大纲；一个项目可以放几本，按学习顺序编号、可调序。
- **采用学习路线**——每本教材一条路线，由教练起草，你在侧栏「采用为本书路线」或「放弃」；新草稿覆盖旧草稿，重新采用时已有进度保留。路线只放关卡，导论类章节是旁边可跳的小站，「本路线不学」的章节单独列出。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-roadmap.png" width="640" alt="一本教材的页面：S 形学习路线，各站的进度，下面是「本路线不学」的章节">

- **拍照记划线和批注**——在侧栏拍一页书，教练一次读出印刷文字和所有划线、批注：确定的一键成卡，拿不准的单独列出。知识卡片可以按来源筛选、搜索，标记已掌握或删除；相同的词或概念自动合并，不重复建卡。教练记下的薄弱点会在侧栏弹出「已记下」，可撤销。
- **章节考**——学完一站做一套卷。题目从两个方向定：考什么（我划的 / 我问过的 / 我答错的 / 本章主题）× 凭什么出（照片里的原句 / 网上原文附链接 / 领域知识）。选择与填空当场判，开放题交给教练判；觉得哪题有问题可以标出来作废，不计分。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-quiz.png" width="640" alt="一站的章节考：选择题与填空题当场判对错，开放题标着「交给教练判」">

- **待订正与考点掌握**——每站列出本站考点。答错的题进入这一站的「待订正」，订正不计入过关成绩；答对的题移出待订正，考点随之变化：薄弱（有待订正，或教练备注后还没考对）→ 巩固中 → 掌握（没有待订正，至少 3 道不同的题答对、分布在 2 次作答里），点开看依据。达标的站解锁下一站。
- **今日复习**——今日页把各站答错的题汇总成一份订正卷，加上到期的卡片。复习是作答：原句填词、选本句义、拼写、概念自答，结束有小结和「再练错的」，也保留翻卡模式。「最近的变化」列出哪些考点刚变成薄弱或掌握。

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/library-points.png" width="640" alt="一站的考点列表：薄弱、巩固中、掌握三种状态，上方是「待订正 · N 题」入口">

- **会话跟着书走**——会话可以绑定一个项目或其中一本书，会话头部的芯片显示并切换绑定；需要模型的动作（加书、排路线、出题、判开放题）由侧栏把请求填进输入框，你确认后发出。
- **手机上也能用**——一套界面按宽度自适应，手机上全屏。项目有颜色和图标，书有自动生成的封面。

## 安装

推荐装学习套件，连同基础体验一起：

```sh
dsh plugin --profile web add @khorsheed/dsh-basic @khorsheed/dsh-learning-suite
```

装好后重启实例，在会话的模式选择器里切到「学习模式」：教练人格加上图书馆的模型工具。

进阶：只装本包。

```sh
dsh plugin --profile web add @khorsheed/dsh-library
```

单装时只有宿主服务与数据面，**没有模型工具**（它们由 `@khorsheed/dsh-learning-suite` 声明的 `preset-dsh-learning` 按会话授予）；图书馆侧栏按会话自隐，只在拿得到图书馆工具的会话里出现（标准模式下隐藏）。所以单装要配合一个授予 `@khorsheed/dsh-library/tool` 的模式使用。卸载即全部消失。

## 工作区接入接缝（服务端消费）

把本包挂到**隔离 Context + 独立 stateRoot** 上是受支持的消费方式：挂载方在自己的 Context 上以本包的 `apply` + `config.stateRoot` 起一份独立实例——状态全部按实例绑定（`<stateRoot>/state.json`、`bindings.json`、`projects/<项目 id>/`）；服务核心的动词都不需要会话（绑定以会话 id 为键，是数据，不是前提）。

```ts
import { apply } from '@khorsheed/dsh-library'

apply(isolatedCtx, {
  stateRoot: '/path/to/instance-state/library',
})
```

挂载侧的义务与语义：

- **`capabilities` 动词是展示契约**：`remote.library.capabilities()`（宿主侧 `service.capabilities()`）回答 `{ protocolVersion: 1, hasStorage, storageUnavailableReason?, hasAttachments }`——存储可写性与其原因（store 探测的原文）、附件存储在调用时刻的探测结果。只读展示：强制执行照旧发生在写边界（`storage-unavailable` / `unavailable` 拒收）；形状只增不改，新字段永远可选（reader 的演进规则）。
- **附件按调用探测**：图像路由（`savePhoto` / `readPagePhoto`）每次调用都重新 `ctx.get('attachments')`；把实例挂在一个没有附件服务的 Context 上，这两条路由降级为 `unavailable` 拒收——绝不抛错，其余一切照常。
- **状态根是部署本地路径**：存储走裸 `node:fs`（原子写 + 项目级锁 + append-only JSONL），刻意不经 `ctx.fs` 的会话沙箱。需要把状态放进某个被同步 / 共享的目录时，把 `stateRoot` 直接指到那个路径本身——实例不感知也不参与任何同步机制。
- **文件锁跨实例真互斥**：同一 `stateRoot` 上并存（或先后）的实例靠 `projects/<id>.lock`、`state.json.lock`、`bindings.json.lock` 真正协调——一个实例持锁时另一个的写等待，锁释放后落盘，绝不写穿。
- **dispose 终态 + 同根重建**：`dispose()` 幂等且终态，并随借入 Context 的销毁自动触发（构造时 `ctx.effect` 接线）——之后每个公开动词（含读取）都以带码的包名错误 `LibraryDisposedError`（`code: 'disposed'`）拒绝；与 dispose 竞态的写在拿到锁之前就被编码拒绝（盘侧本就有锁 / 临时写 / 原子改名兜底）。同根重建合法：同一 `stateRoot` 上新建服务实例照常工作，旧实例写入的数据都在。
- **本地行为零变化**：除这些新增面之外，一切语义与之前逐字节一致。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| npm 发布线（0.2.0-rc.x） | 完整支持（`minHost: 0.1.7-rc.1`：右栏页面型 tab 与 Remote 面之外无宿主新 API；preset 授予需 0.1.7-rc.1 的 `@deepseek-ai/dsh-agent-preset` 行类型——那由 bundle 包声明） |
| deepseek-harness master（0.2.1-rc.1 开发线） | 已验证（`verifiedHost: 0.2.1-rc.1`）——host-021 波对 0.2.1-rc.1 树全量 build+test 绿，无其它表面变化 |

细节见 package.json 的 `dsh.compat.notes`：状态走 `$DSH_HOME/state/dsh-library` 的裸 `node:fs`（原子写 + 项目级锁 + append-only JSONL），不经 `ctx.fs`（会话沙箱会拒）；照片经探测的 `attachments` 服务保存与读回，缺席报 `unavailable` 错误码。

## 已知限制

- **不上传书**——不做书籍文件上传与解析（EPUB / PDF）。
- **拍照要经过会话**——侧栏的拍照按钮代你在会话里发一条带图消息，识别由会话里的教练完成。
- **暂不做**——会话内「精读」tab、XP 与连续天数、项目级考试与跨书打通。

## 实现原理

<details>
<summary>内部结构（点击展开）</summary>

**侧栏。** 右栏页面型 tab（kind `library`）的导航：今日 → 项目（继续学习、待采用草稿、按学习顺序编号的教材与各自进度、资料链接；删除项目与教材都弹确认框写明影响）→ 教材（路线草稿或 S 形路线，外加「本路线不学」的章节；怎么用这本书 / 答案 / 附录放在书页的「开始前 / 附录」条）→ 这一节（导读 / 我的记录 / 章节考）→ 知识卡片 → 章节考 → 结算 → 复习。tab 类型按 canvas 双查判据（根行 ∪ 当前会话 preset 行里的 `@khorsheed/dsh-library/tool`）自隐，一切不可读路径 fail-open。

**书与教材。** 书就是资源（`library_resource` 带 `kind: "book"` 与目录）；书型分知识型 / 材料型，材料型书不接受凭记忆出的内容题。教材按学习顺序编号（`seq`）。项目不带路线，路线只属于教材。

**路线。** 采用时保留同 id 节点的进度。节点分 quiz（过章节考）、acceptance（按验收行判）与 read（「读完」即过）；站用章节号指向本教材，附带链接或讲授不改变路线归属。

**照片页。** 一页照片一次记录印刷文字与所有划线 / 批注；照片只存附件引用，读回只允许本项目记录过的页。照片页要求完整 attachment 引用（attachmentId + mediaType + bytes + width + height——从消息的 image block 原样抄），否则报 `ref-incomplete`。

**知识卡片。** 写入路径查重——归一化键（大小写、全半角、标点、英文复数）完全相同自动合并，疑似重复退回候选由教练选 `mergeInto` / `asNew`；薄弱度 0–3 与复习间隔（Leitner）分开记；卡片可挂书或挂项目；记录可撤销。

**判题级联**（`library_assess`）。作废题不计分；考对的卡升格并减薄弱度，答错的回到明天并加薄弱度；没挂卡的错题不自动建卡（教练明确点名单词或概念时才建），而是进入本站「待订正」；考点状态变化写入事件，今日页「最近的变化」据此显示；节点达标解锁后继，订正卷不影响过关。

**会话绑定。** 会话可绑项目或项目下的某本书，工具的 project / book 参数默认取绑定；每轮经 `systemPrompt.context` 注入一行绑定上下文（当前书、节点、最薄弱的卡）。

**模型工具面**（`./tool` 组合入口，preset 按会话授予）：`library_read`、每个名词一个写工具（`library_project` / `library_resource` / `library_roadmap` / `library_notes` / `library_page` / `library_cards` / `library_quiz` / `library_binding`）、`library_assess`，用法写在工具描述里，拒收信息自带正确用法。可选 `hideSections` / `denyTools` 在该 scope 里静音根上无关的提示段与工具。

</details>

## 开发

```sh
pnpm run build   # gen-typert → tsc → tsdown
pnpm run test    # vitest
```

隶属 [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo（`packages/library`）。问题与贡献请移步该仓库。

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。
