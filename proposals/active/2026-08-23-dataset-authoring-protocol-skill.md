# 数据集作者协议与 skill（dataset-authoring）

- **分类**：plugin
- **状态**：idea（协议 v1 经评估 agent 一轮参谋已修订，见附录；待方向确认后升 planned）
- **最后更新**：2026-08-23
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）；skill 作生成侧告知有先例（`2026-08-21-file-view-html-rendering` 的 `3d-artifact` skill），无同意图提案
- **官方依赖**：纯插件（skill 发行走 `dsh-skill-filesystem` 的 `customSkillDirs`/`bundledSkillDir` config，可经 cordis.patch.yml 注入；若发现更干净的声明式 seam 缺席，记 upstream 候选）

姊妹提案：[datasets](2026-08-19-datasets-store.md)、[mission](2026-08-19-mission-tasks.md)。

## 目标

打通「跟 dsh（或任何 agent）聊天出数据集 → datasets tab 展示 → mission 开评」的闭环：

1. **数据集作者协议（Dataset Authoring Protocol）**——独立的、agent 无关的文档（附录 v1 修订稿）。核心心智：**用户不用管自己的文件怎么命名、怎么摆**——写一个统一的注册文件（dataset.json），声明哪些是题目、哪些是验收、哪些是评分、哪些模型可见；布局约定只是零配置的退化形态。
2. **skill（`dataset-authoring`）**——定位是**注册引导**：教 agent 把用户已有的文件按协议注册进数据集（多写一个 descriptor 文件）；数据集内容怎么写，是用户和模型之间的事，skill 不管。公开发行，其他 agent 工具链读同一份协议。
3. **绑定确认流**——认出注册文件 → 预填 → 用户确认；**默认只勾 modelFacing:true 的层，敏感层手动加**（默认安全）；无 card → L1 目录推断预填 → 确认；推断不出 → 手动配。

## 现状

- **调研结论**（HF/Kaggle/eval 框架）：descriptor-first 被否定；通行做法是「内容先行 + 一份轻注册文件 + 工具帮生成草稿」。用户的命名自由诉求与 OpenAI evals（JSONL + 几行注册 YAML）、lm-eval（YAML 指 dataset_path）同构。
- **绑定确认侧已就绪大半**：三段式绑定表单（`previewRepo` 实时校验 + chip 多选预填，`e58526d`）。
- **skill seam**：`dsh-skill-filesystem` 从项目目录 + `customSkillDirs` + bundled 目录发现 skill；`SKILL.md` 单文件形态与 Claude Code 等外部工具链兼容。
- **自验面**：descriptor 形状校验已在读取路径 fail loud + 混合敏感度 warn（`17bb987`）；缺独立 `validate` 动词，本提案补上（含字段名启发式）。

## 方案

### 协议（附录 v1 修订稿）

独立文档，落本仓库 `docs/` 并随 datasets 包发行。**单一事实源纪律**：校验器、skill、绑定表单预填逻辑都从协议派生；协议里的每个 JSON 示例进测试夹具直接喂校验器。

v1 修订稿相比初稿的变化（评估 agent 五条全部合入 + 命名自由）：① item.json 与透传区同级的措辞硬化；② 注册文件新增可选 `register` 显式映射（任意路径 → item/层角色），布局约定退化为零配置默认；③ §3 给正例；④ 默认安全落入确认流（见下）；⑤ validate 加字段名启发式。

### skill（`dataset-authoring`）：注册引导

教 agent 的注册流程：读用户已有文件 → 判断角色（题目/验收/评分/可见性）→ 产出 dataset.json（布局规整或 register 映射，按现状取便宜的）→ 跑 `dsh-datasets validate` 自验 → 非零即修。**不教内容创作**。刻意不内嵌完整规格——规格让模型读协议文档，skill 与校验器永不同步漂移。

### 发行形态

- dsh 内：datasets 包携带 `skills/dataset-authoring/SKILL.md`，patch 层注入 skill 目录；
- 公开：`SKILL.md` + 协议文档在本仓库公开位置；README 写清其他 agent 工具链的取用方式。

### 绑定确认流增强

- 认出 card：确认摘要呈现「N 个数据集 · 层 [visible / verify·敏感 / grading·敏感]」；
- **默认只勾 modelFacing:true 的层**，敏感层要手动加勾（默认安全）；
- **敏感层隐藏文件式呈现**：树上未纳入白名单的层/文件弱化显示（暗色 + `· 敏感` 标记），可展开看文件名，点击给「不在本会话白名单内」提示而非内容——展示存在、不展示内容，白名单机制强度不变（read/Remote/worktree 仍物理拒绝）。`list`/`show` 对未纳入层返回存在标记（名称 + 计数 + `restricted`），不返回内容；
- 无 card：如实标注「未分层，全部可见」（L0/L1）。

## 里程碑

- M1：协议 v1 定稿（本轮评审修订已合入，方向确认后定稿）+ 落 `docs/` + 校验器一致性测试（协议示例当夹具）+ `dsh-datasets validate` 动词（CLI + 工具：形状 + 混合敏感度 warn + **字段名启发式 warn** + 退出码）
- M2：`dataset-authoring` skill（注册引导）+ dsh 内发行接线 + 外部工具链取用文档
- M3：绑定确认流的默认安全（默认只勾可见层 + 敏感层提示行）与「认出 card」呈现

优先级说明（评估 agent 建议，采纳）：M1 是刚需（协议文档本身就解决「布局要读源码注释才知道」）；skill 的价值随数据集作者增多兑现，M2 时机看流程实测体验再定——除非 datasets 公开发行路线提前，届时 skill 是必要投入。

## 实现记录

（实施时追加 Agent Note / PR / 包名）

## 验收标准（done 判定）

1. agent 仅凭 skill（不读插件源码）把任意命名的既有文件注册成合规数据集：`validate` 全过、tab 认出并预填、确认后可绑定浏览。
2. 协议文档的每个示例在测试里直接过校验器（防漂移钉死）。
3. 确认流默认安全实测：绑定含敏感层的数据集，默认勾选不含敏感层；敏感层手动加勾后生效；树上有「未纳入」提示。
4. skill 在 dsh 内被发现可触发；同一 `SKILL.md` 在一个外部 agent 工具链里按文档取用可行。
5. 零配置目录（无 card）绑定仍可用（L0），界面如实标注「未分层」。
6. `pnpm run build && pnpm run test` 绿；双语 README/文档同步。

## 风险 / 放弃的东西

- **协议漂移**：skill、校验器、表单三处消费同一份协议——靠「协议示例进测试夹具」+ skill 不内嵌规格来防。
- **register 映射的实现面**：任意路径映射会让层过滤从「目录前缀」变成「路径清单」（sparse-checkout 非 cone 模式可表达，但校验与 worktree 都要跟上）；v1 收窄到「路径必须在仓库内、glob 仅限单层通配」。
- **skill seam 是 config 注入**：若评审认为不够干净，记 upstream seam 候选（声明式 `dsh.skill` 字段），不阻塞。
- **YAML vs JSON**：v1 descriptor 是 JSON。补充数据点（评估 agent 实测）：从零手写 dataset.json 不难，**把既有 meta.yml 转成 item.json 才痛**——若将来支持 YAML，优先级是「人工维护既有数据集」高于「从零建」。
- **协议公开 = 承诺**：发布后协议演进走版本（协议带 version 字段），v1 收窄到已验证能力面。

## 附录：数据集作者协议 v1（修订稿，待方向确认）

```text
数据集作者协议（Dataset Authoring Protocol）  v1-rev1

0. 一个数据集 = 一个 git 仓库里的 datasets/<dataset-id>/ 目录；一个仓库可含多个数据集。
   版本 = git commit；评测 run 经 snapshot 固化 {repo, commit, datasetId}。
   你的文件不用改名、不用搬家：角色由注册文件声明（§2 的 register），
   目录布局只是零配置的默认形态。

1. 布局（默认形态；用 register 时可自由）
   datasets/<id>/
     dataset.json              # 注册文件，见 §2
     <其他顶层文件/目录>         # 透传区：对所有绑定会话可读，不校验、白名单管不到。
     <layer>/…                 # 题集级共享层（目录名须在 layers 声明）
     items/<item-id>/
       item.json               # item 元数据。★ 与透传区同级：白名单管不到、
                               #   未声明字段直通——敏感内容一律不放
       <layer>/<文件…>          # item 级层

2. dataset.json
   {
     "id": "<dataset-id>",                 // 与目录名一致
     "name": "人类可读名",
     "layers": [
       { "name": "visible", "modelFacing": true  },   // 模型/选手可见（题面、验收标准）
       { "name": "verify",  "modelFacing": false },   // 判定用（测试、helpers），判定时才用
       { "name": "grading", "modelFacing": false }    // 评分/答案（rubric、oracle），永不下发
     ],
     "itemMetaSchema": { …JSON Schema 子集… },          // 可选
     "register": [                                      // 可选：显式把任意路径注册进角色
       { "item": "F1", "layer": "visible", "files": ["docs/intro.md", "specs/*.md"] },
       { "item": "F1", "layer": "grading", "files": ["notes/f1-rubric.md"] }
     ]
   }
   纪律：每个层必须显式声明 modelFacing；混合敏感度数据集里缺键的层会被 warn。
   register 约束（v1）：路径必须在仓库内；glob 仅限单层通配；与布局形态冲突时 fail loud。

3. 可见性纪律（协议的核心，违反即泄题）
   - modelFacing 语义：该层能否进入「模型可见面」（物化进执行环境、发给选手、agent 工具可读）。
   - 判定类内容 → modelFacing:false 层，由编排方在判定时挂载，做题时不可见。
   - 评分/答案类内容 → modelFacing:false 层，永不下发；导出分享收录这些层要过人工确认闸。
   - item.json 与透传区不受白名单保护（机制上不经过层过滤），视同永远可见——
     敏感内容一律不放。
   - 正例：题目的敏感注解（含技术路径的提示）放 grading 层、按 item id 对应，
     如 items/F1/grading/standards-notes.yml。

4. 共享内容：跨 item 共用且有可见性要求的内容（如验收 helpers）放题集级层
   datasets/<id>/<layer>/，不要在每个 item 里复制（严格程度会漂移）。

5. 自验：产出完成后运行 dsh-datasets validate（或调用 datasets_validate 工具）。
   形状错误与非零退出必须修到全过；警告应当回应而非忽略。警告包括：
   - 混合敏感度数据集里未表态的层（MODELFACING_UNDECLARED）；
   - item.json 里出现 note / hint / answer / rubric / grading 词根的键
     （FIELD_NAME_SENSITIVE——便宜的字面启发式，专门抓「敏感备注写错地方」）。
```
