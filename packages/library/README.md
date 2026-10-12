# @khorsheed/dsh-library

图书馆与学习引擎：按项目组织的精读。书只登记不上传（模型联网核对版本与目录），每本书一条由教练起草、用户采用的学习路线；拍照记下的划线与页边批注、问答里暴露的薄弱点、考试答错的题，都沉淀为用户自己的「知识卡片」；章节考按「考什么 × 凭什么」两轴出题，判题落账后推进路线。

## 特性

- **图书馆侧栏**（右栏页面型 tab，kind `library`，一套界面按宽度自适应，手机上全屏）：今日（到期复习、接着读、教练最近记下、项目）→ 项目（书与各自进度、知识卡片、复习）→ 书（路线草稿「采用 / 放弃」，或 S 形路线）→ 这一节（导读 / 我的记录 / 章节考）→ 知识卡片（按来源筛选、搜索、已掌握 / 删除）→ 章节考（选择与填空当场判，开放题交教练判）→ 结算 → 复习翻卡。需要模型的动作（加书、排路线、出题、判开放题）由侧栏绑定会话并把请求填进输入框。
- **书只登记**：书名、版本、ISBN、书型（知识型 / 材料型）与目录（附来源 url）。不解析任何文件。
- **路线草稿 → 采用**：教练写草稿，用户在侧栏「采用」后才生效；采用时保留同 id 节点的进度。节点分 quiz（过章节考）与 read（「读完」即过）。
- **照片页**：一页照片一次记录印刷文字与所有划线 / 批注，确定的标记一键成卡，拿不准的单列；照片只存附件引用，读回只允许本项目记录过的页。
- **知识卡片**：写入路径查重——归一化键（大小写、全半角、标点、英文复数）完全相同自动合并，疑似重复退回候选由教练选 `mergeInto` / `asNew`；薄弱度 0–3 与复习间隔（Leitner）分开记；卡片可挂书或挂项目；记录可撤销。
- **两轴出题**：考什么（我划的 / 我问过的 / 我答错的 / 本章主题）× 凭什么（照片原句 / 网上原文 + url / 领域知识）。材料型书不接受凭记忆出的内容题。
- **判题级联**：作废题不计分；考对的卡升格并减薄弱度，答错的回到明天并加薄弱度，无卡的错题自动建卡；节点达标解锁后继。
- **会话绑定**：会话可绑项目或项目下的某本书，工具的 project / book 参数默认取绑定；每轮注入一行绑定上下文（当前书、节点、最薄弱的卡）。
- **模型工具面**（`./tool` 组合入口，preset 按会话授予）：`library_read`、`library_write`、`library_assess`，用法写在工具描述里，拒收信息自带正确用法。可选 `hideSections` / `denyTools` 在该 scope 里静音根上无关的提示段与工具。
- **自隐**：tab 类型按 canvas 双查判据注册，一切不可读路径 fail-open。

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

## 安装

```sh
dsh plugin --profile <name> add @khorsheed/dsh-library
```

只装本包：图书馆 tab 与数据面可用；模型工具不存在（它们由 `@khorsheed/dsh-presets` 声明的 `preset-learning` 按会话授予）。卸载即全部消失。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| npm 发布线（0.2.0-rc.x） | 完整支持（`minHost: 0.1.7-rc.1`：右栏页面型 tab 与 Remote 面之外无宿主新 API；preset 授予需 0.1.7-rc.1 的 `@deepseek-ai/dsh-agent-preset` 行类型——那由 bundle 包声明） |
| deepseek-harness master（0.2.0-rc.2 开发线） | 已验证（`verifiedHost: 0.2.0-rc.2`） |

细节见 package.json 的 `dsh.compat.notes`：状态走 `$DSH_HOME/state/dsh-library` 的裸 `node:fs`（原子写 + 项目级锁 + append-only JSONL），不经 `ctx.fs`（会话沙箱会拒）；照片经探测的 `attachments` 服务保存与读回，缺席报 `unavailable` 错误码。

## 已知限制

- 不做：书籍文件上传与解析（EPUB / PDF）、会话内「精读」tab、XP 与连续天数、项目级考试与跨书打通。
- 拍照由侧栏代你在会话里发一条带图消息，识别由会话里的教练完成。
- 会话头部芯片显示并切换本会话绑定的项目或书；教练记下薄弱点时侧栏弹出「已记下」并可撤销。
- 项目有颜色与图标，书有自动生成的封面；路线只放关卡，导论类是旁边可跳的小站，怎么用这本书 / 答案 / 附录放在书页的「开始前 / 附录」条。
- 复习是作答：原句填词、选本句义、拼写、概念自答，结束有小结与「再练错的」；保留翻卡模式。
- 照片页要求完整 attachment 引用（attachmentId + mediaType + bytes + width + height——从消息的 image block 原样抄），否则报 `ref-incomplete`。

## 开发

```sh
pnpm run build   # gen-typert → tsc → tsdown
pnpm run test    # vitest
```
