# Agent Note：房间输入框支持图片和文件

状态：已实现

[English](2026-10-27-room-composer-attachments.md) | 中文

## 问题

房间接管了官方输入框，从输入框经 `postMessage` 到各个成员全程只传文字，所以房间收不了截图和文件。被它替换掉的官方输入框是可以的。

## 决定

- **草稿附件用官方的。** 输入框复用官方会话服务的草稿附件：`createDrafts`（选中文件就开始上传到房间会话）、`fileUploads`、`resolveDraftAttachments`、`serializeDraftAttachments` 和 `releaseDraftAttachment`。附件 id 记在会话的输入状态机上（`addAttachments` / `removeAttachment` / `pruneAttachments`），和草稿文字放在一起，切换会话后同样保留。宿主没有这些接口时，不提供附件功能。
- **添加入口。** 输入框工具行最前面放回形针按钮；也可以把文件粘贴进输入框，或拖到卡片上。
- **附件栏照着官方重画。** 沿用官方的尺寸和样式变量：64px 缩略图，点开用公共库的 `ImageLightbox` 看原图；240×64 的文件卡片，显示上传状态、可重试、悬停出现 ✕。`@deepseek-ai/dsh-client-ui-attachment` 没有导出插件包能引用的客户端组件，它的附件栏只能在官方输入条自己的子插槽里渲染。
- **宿主按自己的提示词流程收附件。** `postMessage` 接受官方传输格式的 `attachments`：图片是 base64，文件是上传回执。回执通过 `fileUploads.resolve` 在房间会话的 agent 上解析，房间还没唤醒时先唤醒。图片经 `attachments.admitPromptContent` 存储，人的 `user/message` 带上持久化的内容块（由官方的用户消息节点渲染），回执绑定到这条消息。
- **成员拿到本地路径。** 每个被点名成员收到的消息末尾加一份附件的本地路径清单（`imageHostPath` / `fileHostPath`），由成员用自己的读取工具打开。CLI 成员和原生成员都用这一种方式。dispatch 记录里保存了这些路径，重试时会一起再发。

## 考虑过的方案

**按每种 CLI 接原生的图片输入**（claude 的 stream-json 图片、codex 的 `-i`）。暂缓：要同时维护四套传输格式，而路径方式现在就对所有成员都管用。

**直接引用 ui-attachment 的附件栏。** 做不到：构建检查要求官方客户端包保持外部引用，而这个包的客户端入口只导出了 `apply`。

## 后果

- 只发附件不写字时，消息以「（见附件）」发出。
- 如果宿主的附件存储不落盘，就拿不到路径，成员会被告知打不开附件。
- 在桌面端拖入文件，会上传文件，而不是像官方输入框那样变成路径标签。
