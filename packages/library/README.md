# @khorsheed/dsh-library

图书馆与学习引擎：按项目组织的精读——书籍摄入（EPUB/Markdown）、每本书一条 locked→current→done 的学习路线图、带 Leitner 掌握度与照片出处的词书、过 evidence 闸的测验与判题解锁。

## 特性

- **图书馆页**（右栏页面型 tab，kind `library`）：项目墙（双列卡 + 进度条 + 到期词卡区）→ 项目视图（书籍行 + EPUB/MD 拖放摄入 + 目录）→ 书籍视图（左轨时间线路线图 + 重新拆书按钮）→ 词书视图（词条 + 掌握度格点 + 到期标 + 出处）。
- **摄入在浏览器半**：EPUB 走 fflate 解 zip → DOMParser 读 OPF spine / NCX|NAV → 白名单消毒；Markdown 按标题层级切章。失败给诚实错误分类（不是 zip / 不是 EPUB / DRM / 无阅读顺序 / 没有可读章节）。PDF 不支持（渲染器不是结构提取器，reader D2 同结论）。
- **模型工具面**（`./tool` 组合入口，preset 按会话授予）：`library_read`（projects/books/toc/chapter/roadmap/vocab/due/quiz/stats）、`library_write`（project/book/roadmap/notes/quiz——quiz 每题必须 `ch:<n>` chapterRef + 原文 evidence，缺失拒收并教正确格式）、`library_assess`（verdict 落账 → 词卡 Leitner 升降 → 节点 quizStats → 达标解锁下一节点）。随行 `library` skill 带逐 what 的 payload 形状与示例。
- **自隐**：tab 类型按 canvas 双查判据注册（profile 根行 ∪ 当前会话 preset 行的 `@khorsheed/dsh-library/tool`），一切不可读路径 fail-open。

## 安装

```sh
dsh plugin --profile <name> add @khorsheed/dsh-library
```

只装本包：图书馆 tab 与数据面可用；模型工具不存在（它们由 `@khorsheed/dsh-bundle-learning` 声明的 `preset-learning` 按会话授予）。卸载即全部消失。

## Compatibility

| 宿主线 | 结论 |
|---|---|
| npm 发布线（0.2.0-rc.x） | 完整支持（`minHost: 0.1.7-rc.1`：右栏页面型 tab 与 Remote 面之外无宿主新 API；preset 授予需 0.1.7-rc.1 的 `@deepseek-ai/dsh-agent-preset` 行类型——那由 bundle 包声明） |
| deepseek-harness master（0.2.0-rc.2 开发线） | 已验证（`verifiedHost: 0.2.0-rc.2`） |

细节见 package.json 的 `dsh.compat.notes`：状态走 `$DSH_HOME/state/dsh-library` 的裸 `node:fs`（原子写 + 项目级锁 + append-only JSONL），不经 `ctx.fs`（会话沙箱会拒）；照片出处读回经探测的 `attachments` 服务，缺席报 `unavailable` 错误码；`readAttachmentBase64` 白名单只允许词书条目实际记录的 attachmentId。

## 已知限制

- v0.1 不做：会话内「精读」tab、交互式答题卡（出题/判题走会话消息流）、PDF、iOS 真机验收、datasets/mission 集成。
- 章节正文分页 100KB 预算；一本书经一次 Remote 调用上架（章节已在浏览器解析好）。
- 词书照片读回要求条目带完整 attachment 引用（attachmentId + mediaType + bytes + width + height——模型从消息的 image block 抄全），否则报 `ref-incomplete`。

## 开发

```sh
pnpm run build   # gen-typert → tsc → tsdown
pnpm run test    # vitest
```
