# Agent Note：novel_write 不带 `replace` 绝不覆盖已有的章节正文

Status: implemented

## Problem

用户在 3080 上导入一份已经放在工作区里的原稿（`梦境守护者/第1章.md`，约两万五千字）。skill 写明这种情况用 `novel_write(chapter, title, byUser=true)` 登记，**不带** `content`。模型却把一句说明当作 `content` 传了进来：「（内容见工作区 梦境守护者/第1章.md — 用户原稿整理落盘…）」。

`writeChapter` 用这句话覆盖了文件。它先 stat 文件，再按刚拿到的版本号替换，所以没有任何东西拦住这次覆盖。章节页随后如实预览出这一行。原文是手工从会话记录里恢复的。

## Decision

- **正文绝不被隐式覆盖。** 目标文件已有非空正文时，除非请求带 `replace: true`，否则拒绝 `content`，返回新增的 `NovelError` `'body-exists'`。检查在写入和登记之前进行，被拒的调用不会改动文件，也不会改动章节表。
- **工具：**
  - `novel_write` 新增 `replace` 参数。
  - 拒绝信息会报出已有正文的字数。
  - 拒绝信息提示：只登记就不要带 `content`；要整章替换，先 `novel_read` 读原文，再带 `replace=true` 写全文。
- **skill：**
  - 导入那一行写明 `content` 会成为文件的全部内容，不是说明。
  - 第一条铁律写明：整章替换式的改稿，先读原文，再带 `replace=true`。
- **客户端：** 客户端错误文案新增 `error.body-exists`。

## Alternatives considered

- **识别像占位符的 content**（文字很短、含「见工作区」）。不采纳：这是启发式。真正的不变量是「登记永远不毁掉正文」。
- **每次替换都留一份备份。** 不采纳：读过原文后显式带 `replace` 是有意的修改，撤销交给宿主的文件历史。

## Consequences

- 模型改自己的稿子现在要带 `replace=true`。只多一个参数，拒绝信息里已经写明。
- 测试：
  - `store.spec` 新增一条：被拒、文件与章节表都没动、只登记可以、显式替换生效。
  - 用户原稿改稿那条改为带 `replace: true`。
