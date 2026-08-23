# 数据集作者协议与 skill（dataset-authoring）

- **分类**：plugin
- **状态**：idea（协议 v1 为草稿，待评估 agent 参谋后再升 planned）
- **最后更新**：2026-08-23
- **查重结果**：已搜 `proposals/active/` + `proposals/closed/` + `.agents/notes/`（含 archived）；skill 作生成侧告知有先例（`2026-08-21-file-view-html-rendering` 的 `3d-artifact` skill），无同意图提案
- **官方依赖**：纯插件（skill 发行走 `dsh-skill-filesystem` 的 `customSkillDirs`/`bundledSkillDir` config，可经 cordis.patch.yml 注入；若发现更干净的声明式 seam 缺席，记 upstream 候选）

姊妹提案：[datasets](2026-08-19-datasets-store.md)、[mission](2026-08-19-mission-tasks.md)。

## 目标

打通「跟 dsh 聊天出数据集 → datasets tab 展示 → mission 开评」的闭环，并让协议本身成为公共资产：

1. **数据集作者协议（Dataset Authoring Protocol）**——一份独立的、agent 无关的文档（附录 v1 草稿），定义布局、descriptor、可见性纪律、版本与自验。
2. **skill**——教 dsh（及任何兼容 SKILL.md 的 agent 工具链）按协议产出数据集；公开发行，用户用 Claude Code / Codex 等其他 agent 出数据集时拿到的是同一份协议。
3. **绑定确认流**——datasets tab 认出目录里的 card → 预填（数据集、层、白名单）→ 用户点确认；无 card → L1 目录推断预填 → 确认；推断不出 → 手动配（L0/L1/L2 渐进门槛见 datasets 提案的调研结论）。

## 现状

- **调研结论**（HF/Kaggle/eval 框架）：descriptor-first 是被否定的模式；通行做法是「内容先行 + card 可选后补 + 工具帮生成草稿」。skill 恰好是我们生态里「帮生成草稿」的载体，比 HF 的 Metadata UI 更顺（写内容的同一个 agent 顺手产出 card）。
- **绑定确认侧已就绪大半**：三段式绑定表单（`previewRepo` 实时校验 + chip 多选预填，commit `e58526d`）就是「认出 card → 用户确认」的承载面。
- **skill seam**：`dsh-skill-filesystem` 从项目目录 + `customSkillDirs` + bundled 目录发现 skill；插件可经 patch 层 config 注入 skill 目录（ankh-guard/file-preview 有 skill 字段引用的先例）。`SKILL.md` 单文件形态与 Claude Code 等外部工具链兼容。
- **自验面**：descriptor 形状校验已在读取路径 fail loud + 混合敏感度 warn（`17bb987`）；缺一个独立的 `validate` 动词（现在要靠 `show` 顺带触发），本提案补上。

## 方案

### 协议（见附录 v1 草稿）

独立文档，放本仓库 `docs/` 并随 datasets 包发行。**单一事实源纪律**：校验器实现、skill 内容、绑定表单预填逻辑都从协议派生；协议里的每个 JSON 示例进测试夹具直接喂校验器（防漂移）。

### skill（`dataset-authoring`）

内容大纲：何时触发（用户要建/改数据集、题库、内容包）→ 协议要点（布局 + 可见性纪律的硬规则）→ 产出后**自验循环**（跑 `dsh-datasets validate`，非零即修）→ 反模式清单（敏感内容进透传区、notes 写进可见层、schema 先行）。

刻意不内嵌完整规格——skill 教流程与纪律，规格细节让模型读协议文档或跑 validate 自验，skill 与校验器永不同步漂移。

### 发行形态

- dsh 内：datasets 包携带 `skills/dataset-authoring/SKILL.md`，patch 层注入 skill 目录；
- 公开：`SKILL.md` + 协议文档在本仓库顶层 `skills/` 或 docs/（公开仓库即发行）；README 写清其他 agent 工具链的取用方式（Claude Code 的 skills 目录、Codex 的 AGENTS.md 引用皆可读同一文件）。

### 绑定确认流增强

认出 card 时在确认区呈现「已按协议识别：N 个数据集 · 层 [visible/verify·敏感/grading·敏感]」的确认摘要；无 card 时明确标注「未分层，全部可见」（L0/L1 的如实呈现）。

## 里程碑

- M1：协议 v1 定稿（评估 agent 参谋后）+ 落 `docs/` + 校验器一致性测试（协议示例当夹具）
- M2：`datasets validate` 动词（CLI + 工具，形状 + 警告 + 退出码）+ `dataset-authoring` skill + dsh 内发行接线
- M3：绑定确认流的「认出 card」呈现 + 外部工具链取用文档

## 实现记录

（实施时追加 Agent Note / PR / 包名）

## 验收标准（done 判定）

1. agent 仅凭 skill（不读插件源码）产出的数据集：`validate` 全过、tab 认出并预填、确认后可绑定浏览。
2. 协议文档的每个示例在测试里直接过校验器（防漂移钉死）。
3. skill 在 dsh 内被发现可触发；同一 `SKILL.md` 在一个外部 agent 工具链（Claude Code 或 Codex）里按文档取用可行。
4. 零配置目录（无 card）绑定仍可用（L0），且界面如实标注「未分层」。
5. `pnpm run build && pnpm run test` 绿；双语 README/文档同步。

## 风险 / 放弃的东西

- **协议漂移**：skill、校验器、表单三处消费同一份协议——靠「协议示例进测试夹具」+ skill 不内嵌规格来防。
- **skill seam 是 config 注入**：若评审认为不够干净，记 upstream seam 候选（声明式 `dsh.skill` 字段），不阻塞本提案。
- **YAML vs JSON**：v1 descriptor 是 JSON（无 parser 依赖）；社区习惯 YAML frontmatter（HF card 形态）——YAML 支持是独立决定，与本提案正交，需要时单开。
- **协议公开 = 承诺**：发布后协议演进要走版本（协议本身带 version 字段），v1 尽量收窄到已验证的能力面。

## 附录：数据集作者协议 v1（草稿，待评审）

```text
数据集作者协议（Dataset Authoring Protocol）  v1-draft

0. 一个数据集 = 一个 git 仓库里的 datasets/<dataset-id>/ 目录；一个仓库可含多个数据集。
   版本 = git commit；评测 run 经 snapshot 固化 {repo, commit, datasetId}。

1. 布局
   datasets/<id>/
     dataset.json              # 必需：声明见 §2
     <其他顶层文件/目录>         # 透传区：对所有绑定会话可读，不校验、不进白名单。
                                #   ★ 敏感内容禁止放透传区
     <layer>/…                 # 题集级共享层（目录名须在 layers 声明）
     items/<item-id>/
       item.json               # item 元数据（受 itemMetaSchema 约束，若有声明）
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
     "itemMetaSchema": { …JSON Schema 子集… }          // 可选
   }
   纪律：每个层必须显式声明 modelFacing；混合敏感度数据集里缺键的层会被 warn。

3. 可见性纪律（协议的核心，违反即泄题）
   - modelFacing 语义：该层能否进入「模型可见面」（物化进执行环境、发给选手、agent 工具可读）。
   - 判定类内容 → modelFacing:false 层，由编排方在判定时挂载，做题时不可见。
   - 评分/答案类内容 → modelFacing:false 层，永不下发；导出分享收录这些层要过人工确认闸。
   - 任何含技术路径或答案线索的备注，禁止出现在 modelFacing:true 的内容里
     （包括 item.json 的可见字段与 visible 层文件的注释区）。

4. 共享内容：跨 item 共用且有可见性要求的内容（如验收 helpers）放题集级层
   datasets/<id>/<layer>/，不要在每个 item 里复制（严格程度会漂移）。

5. 自验：产出完成后运行 dsh-datasets validate（或调用 datasets_validate 工具），
   形状错误与非零退出必须修到全过；警告（如层未表态）应当回应而非忽略。
```
