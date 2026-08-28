# 数据集作者协议（Dataset Authoring Protocol）

**Version: v1-rev1** · [English](dataset-authoring-protocol.en.md)

本协议定义「一个数据集在 git 仓库里长什么样」。它独立于任何 agent 工具链：`@khorsheed/dsh-datasets` 插件的校验器、绑定表单预填、`dataset-authoring` skill 都从本协议派生。协议里的每个 JSON 示例都直接进校验器的测试夹具（防漂移）。

## 0. 心智模型

一个数据集 = 一个 git 仓库里的 `datasets/<dataset-id>/` 目录；一个仓库可含多个数据集。版本 = git commit；评测 run 经 snapshot 固化 `{repo, commit, datasetId}`。

你的文件不用改名、不用搬家到固定层目录：角色由注册文件声明（§2 的 `register`），目录布局只是零配置的默认形态。

## 1. 布局（默认形态；用 register 时可自由）

```
datasets/<id>/
  dataset.json              # 注册文件，见 §2
  <其他顶层文件/目录>         # 透传区：对所有绑定会话可读，不校验、白名单管不到
  <layer>/…                 # 题集级共享层（目录名须在 layers 声明）
  items/<item-id>/
    item.json               # item 元数据。★ 与透传区同级：白名单管不到、未声明字段直通——敏感内容一律不放
    <layer>/<文件…>          # item 级层
```

## 2. dataset.json

```json
{
  "id": "harness-comparison",
  "name": "Harness 对比评测集",
  "layers": [
    { "name": "visible", "modelFacing": true },
    { "name": "verify", "modelFacing": false },
    { "name": "grading", "modelFacing": false }
  ],
  "itemMetaSchema": {
    "type": "object",
    "properties": { "difficulty": { "type": "string" } }
  },
  "register": [
    { "item": "P0-placeholder", "layer": "visible", "files": ["task.md", "docs/*.md"] },
    { "item": "P0-placeholder", "layer": "grading", "files": ["answers/*", "answers/oracle/*"] }
  ]
}
```

- `id` 必须与目录名一致；`name` 可选；`layers` 非空，每层 `name`（段安全：字母数字与 `._-`，不以点开头）+ 可选 `modelFacing`（缺省 `true`）。
- `itemMetaSchema` 可选，仅形状校验为对象（插件不做 JSON Schema 全量校验）。
- `register` 可选：显式把 item 目录内的自由文件注册进 `item`/`层` 角色。**v1 约束**：路径是 item 相对路径、不得越出 item 目录（无绝对路径、无 `..` 段）；glob 仅限单层通配（`*` 不跨 `/`，禁止 `**`）；不得重新注册 `item.json`；与布局形态冲突（同一显示路径同时被约定层目录与 register 覆盖）或精确路径不存在时 fail loud。glob 零命中允许（内容可以后到）。
- 纪律：每个层必须显式声明 `modelFacing`；混合敏感度数据集里缺键的层会被 warn（见 §5）。

## 3. 可见性纪律（协议的核心，违反即泄题）

- `modelFacing` 语义：该层能否进入「模型可见面」（物化进执行环境、发给选手、agent 工具可读）。
- **默认安全**：会话绑定未显式列出 layers 时，`modelFacing:false` 层默认对 agent 不可读；读敏感层必须显式列出（主动、清醒的动作）——忘了列的时候机制拦住你。未声明任何敏感层的数据集不受影响（全部可见）。
- **消费者拆分**：白名单是 agent 的边界（工具 + worktree 物化），不是人的边界——UI 上人始终能看到自己仓库的全部内容（敏感层带 `· 敏感` 标记）；真正没保护的是透传区与 item.json——它们在界面上必须显眼，而不是被藏起来。
- 判定类内容 → `modelFacing:false` 层，由编排方在判定时挂载，做题时不可见。
- 评分/答案类内容 → `modelFacing:false` 层，永不下发；导出分享收录这些层要过人工确认闸。
- item.json 与透传区不受白名单保护（机制上不经过层过滤），视同永远可见——敏感内容一律不放。
- 正例：题目的敏感注解（含技术路径的提示）放 grading 层、按 item id 对应，如 `items/F1/grading/standards-notes.yml`。

## 4. 共享内容

跨 item 共用且有可见性要求的内容（如验收 helpers）放题集级层 `datasets/<id>/<layer>/`，不要在每个 item 里复制（严格程度会漂移）。

## 5. 自验

产出完成后运行 `dsh-datasets validate`（或调用 `datasets_validate` 工具）。形状错误与非零退出必须修到全过；警告应当回应而非忽略。警告包括：

- `MODELFACING_UNDECLARED`：混合敏感度数据集里未表态的层；
- `FIELD_NAME_SENSITIVE`：item.json 里出现 note / hint / answer / rubric / grading 词根的键（便宜的字面启发式，专门抓「敏感备注写错地方」）；
- `UNREGISTERED_FILES`：未被任何层目录或 register 条目覆盖的文件（漏配的文件会静默掉进透传区变成「永远可见」；glob 单层通配盖不住子目录是高频踩法）。
