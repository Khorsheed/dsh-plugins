# Agent Note: 图书馆——library_write 平铺化：顶层字段取代包裹式 payload

Status: implemented

## Problem

第三个真实会话（【新建数学项目并规划学习路线】）在同一个动词上连续失败十几次。主导模式不是值错而是**信封错**：模型把整本书的 payload 摊在参数顶层、或只发 `project + what` 完全不带 payload 字段（六次）、或把散文灌进 id 槽。三工具设计（what + 命名包裹对象）要求模型 (a) 选对 what，(b) 把复杂对象包进正确字段，(c) 嵌套字段全对——三步每一步都是失败点。宿主自家工具（如 `read_skill_file`）用的是平铺类型化参数 + 逐字段描述 + `required` 数组；模型训练的正是这种形状。

## Decision

`library_write` 参数改为**平铺顶层字段**——`title`、`bookKind`、`toc`、`tocSource`、`nodes`、`passRatio`、`note`、`node`、`text`、`attachment`、`label`、`marks`、`cards`、`focus`、`questions`、`op`、`url`、`kind`、`addedBy`、`resourceId`、`name`、`template`、`goal`、`bookId`——每个字段带类型、在模型写它的位置带描述（对照工具的风格）。`project` / `book` 回归纯 scope 选择器（id，`null` 表项目路线）。深层集合（`nodes`、`questions`、`cards`、`marks`、`toc`、`extras`、`tocSource`）带真正的嵌套 JSON Schema——`array<object>` 加逐字段描述，即 `ask_user_question` 的渲染方式——每个都写成 `oneOf [结构化, string]`，JSON 文本传输这条活路不断；`binding` 是 `oneOf [object, null]`。`what`（read / write）与 `verdicts`（assess）恢复 schema 级 `required`，与其他工具一致。嵌套包裹形式（`book: {…}`、`roadmap: { nodes }`…）作为不文档化的兼容形式保留：参数根是开放对象，旧槽位能到达 execute，执行层按「平铺优先、嵌套兜底」合并。教学拒收现在点名缺失的顶层字段（`got title ✗ MISSING · toc ✗ MISSING`）。`library_read` 本就平铺；`library_assess` 的 verdicts 保持结构化 schema，且其 execute 对缺失 / 空 verdicts 给教学报错（裸展开会崩）。

## Alternatives considered

- **拆成 ~10 个单动词工具**（`library_add_book`、`library_draft_roadmap`…）：最纯的对照风格，但打破提示词、playbook 和在途会话都依赖的三动词心智模型，而平铺参数已拿到同等的 schema 层收益。
- **每个 payload 用严格包裹对象 schema**（`book: { type: 'object', properties… }`）：否决——形状一错又会撞上宿主无教学的 schema 拒绝，且 JSON 文本传输（大 payload 模型的退路）将无法通过校验。以软化形式改采用：平铺字段自身携带嵌套结构（`nodes: array<object>…`），每个写成 `oneOf [结构化, string]`，传输退路保留。
- **删掉嵌套兜底**：否决——在途会话的上下文里仍是包裹写法。

## Consequences

- 模型填命名槽位，不再构造包裹对象；「整个 payload 字段缺失」这一失败类别在结构上消失。
- `toc` 保留换行字符串形式；`nodes` / `questions` / `cards` / `marks` 保持 `json` 类型（宿主透传，执行层容忍 JSON 文本）。
- 两条旅程的行为、状态、service API 全部不变——这只是线上形状（wire shape）变更。

## Testing

`tool.spec.ts`：原有嵌套形式的调用全部经兼容合并继续通过；新增 `flat top-level fields` 组（+2）端到端走通 项目→书→路线→讲义→资源 零包裹写法，并把观察到的失败模式（完全不带 payload 字段；id 槽灌散文）钉在各自的教学报错上。119/119 绿。
