/**
 * The `story` skill: the operating manual the three story tools' terse
 * descriptions defer to (the canvas skill precedent — one standing skill,
 * loaded on demand, carrying NO work content: chapter 6 and chapter 60 use
 * the same manual). The body is the CP0 copy deck's §1 verbatim — it is
 * user-reviewed text, and the `./agent` entry registers it beside the tools
 * so it exists exactly where they do.
 *
 * @module @khorsheed/dsh-story-bible/agent
 */

/** The skill's catalog name. */
export const STORY_SKILL_NAME = 'story'

/** The one catalog line the model sees before loading it (CP0 §1). */
export const STORY_SKILL_DESCRIPTION =
  '长篇小说写作工作流：灵感→规划→写作→对账→维护。会话 focus 作品后，涉及写作/设定/章节时使用。'

/** The skill body (CP0 §1, verbatim). */
export const STORY_SKILL_CONTENT = `# story 技能（长篇小说写作工作流）

## 三条铁律
1. 正文只写工作区里 chapters 登记过的文件（续写=append 到该文件末尾）；
   最稳的写法是 story_write(chapter, content=…)：由插件经会话围栏落盘，
   落不进就拒绝登记，绝不会出现「登记了但没文件」。自己用宿主文件工具写时，
   路径必须是挂载工作区内登记的那个。
   设定与记忆只经 story_* 工具落库，绝不在对话里「口头记录」。
2. 不满意的正文不进对账：正文不满意就先改，别对账。审过是人工闸门，永远最后：
   写完 → 对账（story_extract）→ 处理待审 → 用户「审过」收章。
3. 推断分级：拿不准的一律 medium/low，让待审队列过滤；绝不替用户拍板。

## 意图路由
- 闲聊/讨论立意 → 正常聊，不调 story 工具（最多 story_read 查设定）。
- 聊设定 → 识别可固化点，落幽灵卡（story_write · memory, layer=intent, draft）。
- 规划/写第N章 → 三环：规划 → 写作 →（用户审过）→ 对账。
- 用户跳过规划直接喊写：可以写，但先一句话给出你默认的 plan（POV/目标/伏笔操作），
  用户不反对再动笔。

## 灵感落卡
- 「一句话能复述、且影响后续创作」的才落卡；讨论过程、语气感叹不落。
- kind 即归档路由：世界→设定集·世界观 / 人物→人物卡 / 章节→大纲草案 /
  伏笔点子→世界记忆台账 / 原则→设定集·创作原则。kind 拿不准就先问一句。
- 用户没 ✓ 采纳之前，卡的内容不进 brief、不进正文。

## 规划
- story_read(brief, for=plan) → 产出 plan → story_write · chapter(plan)。
- plan 模板：POV / 目标(一句话) / 伏笔操作(具体 id：推进#/暗示#/新埋#/揭晓#) /
  出场角色 / 章末钩子。
- 伏笔操作必须引用台账 id；新埋的给 question。用户确认前不开写。

## 写作
- story_read(brief, for=write)，按结构执行：
  硬约束（canon）违反即返工；
  「知道的事 / 不知道的事」= 角色的边界：他只能说他知道的事；
  在场角色三件套(档案摘要+当前态+近2-3章经历) = 言行依据；
  非 POV 角色只写可观察的外在言行，不写内心。
- 需要呼应旧章具体描写时 story_read(chapter) 单点取，不凭印象编。
- 写完汇报三行：字数 / 动用了哪几条伏笔操作 / 有没有偏离 plan。

## 对账（正文写完之后、审过收章之前）
- story_extract(prepare) → 把素材包作为一次性任务委派 subagent → 拿回 JSON
  → story_extract(import)。
- 汇报格式：计划命中 ✓×n / 计划落空 ×n / 自动入库 ×n / 待你确认 ×n，
  附待确认清单的一句话摘要。

## 维护
- 每 3–5 章主动 story_read(ledger)：沉睡伏笔摆给用户，给建议（下章推/弃置/转设定）。
`
