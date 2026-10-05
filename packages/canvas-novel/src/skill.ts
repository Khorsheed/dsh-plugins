/**
 * The `novel` skill: the operating manual the three novel tools' terse
 * descriptions defer to (the canvas skill precedent — one standing skill,
 * loaded on demand, carrying NO work content: chapter 6 and chapter 60 use
 * the same manual). The body follows the CP0 copy deck's §1, re-cut for the
 * canvas: settings live as cards, and the agent proposes them as ghost cards
 * the user keeps or archives on the board. The `./agent` entry registers it
 * beside the tools so it exists exactly where they do.
 *
 * @module @khorsheed/dsh-canvas-novel/agent
 */

/** The skill's catalog name. */
export const NOVEL_SKILL_NAME = 'novel'

/** The one catalog line the model sees before loading it (CP0 §1). */
export const NOVEL_SKILL_DESCRIPTION =
  '长篇小说写作工作流：设定落卡→规划→写作→对账→维护。会话绑定「长篇小说」画布后，涉及写作/设定/章节时使用。'

/** The skill body. */
export const NOVEL_SKILL_CONTENT = `# novel 技能（长篇小说写作工作流）

## 先确认已接入
看不到 novel_read / novel_write / novel_extract，就是当前会话还没绑到「长篇小说」画布
（工具只授予绑定的会话）。按对话内容绑定：novel_bind() 列出作品，对话说的是哪部就
novel_bind(work=标题)，下一步工具即出现；拿不准是哪部就问用户（用户也可以点会话标题旁的
「绑定作品」自己绑）。一部作品都没有时，请用户先在画布里新建并把创作体裁选成「长篇小说」。
不要拿文件或对话记录凑一个替代方案——设定的正本只能是画布卡片。

## 三条铁律
1. 正文只写工作区里 chapters 登记过的文件（续写=append 到该文件末尾）；
   最稳的写法是 novel_write(chapter, content=…)：由插件经会话围栏落盘，
   落不进就拒绝登记，绝不会出现「登记了但没文件」。自己用宿主文件工具写时，
   路径必须是挂载工作区内登记的那个。
   设定只经 novel_* 工具落到画布卡片上，绝不在对话里「口头记录」。
2. 不满意的正文不进对账：正文不满意就先改，别对账。审过是人工闸门，永远最后：
   写完 → 对账（novel_extract）→ 处理待审与幽灵卡 → 用户「审过」收章。
3. 推断分级：拿不准的一律 medium/low，让待审队列过滤；绝不替用户拍板。

## 意图路由
- 闲聊/讨论立意 → 正常聊，不调 novel 工具（最多 novel_read 查设定）。
- 聊设定 → 识别可固化点，落幽灵卡（novel_write · card）。
- 规划/写第N章 → 三环：规划 → 写作 →（用户审过）→ 对账。
- 用户跳过规划直接喊写：可以写，但先一句话给出你默认的 plan（POV/目标/伏笔操作），
  用户不反对再动笔。

## 设定落卡
- 「一句话能复述、且影响后续创作」的才落卡；讨论过程、语气感叹不落。
- role 即画布分类：人物 / 世界 / 原则 / 伏笔。拿不准归哪类就先问一句。
- 新卡是幽灵卡：用户在画布上 ✓ 采纳之前，内容不进 brief、不进正文。
- 改已有的卡：novel_write(card, id=ref, fields=…)，只给要改的字段。
- 落卡类工具结果不必在对话里逐条复述播报——画布自己会显示；只在需要用户决策时
  说话：plan 确认、待审处理、计划落空。

## 规划
- novel_read(brief, for=plan) → 产出 plan → novel_write · chapter(plan)。
- plan 模板：POV / 目标(一句话) / 伏笔操作(引用台账 ref：推进#/暗示#/揭晓#；新埋给 question) /
  出场角色(ref 或名字) / 章末钩子。
- 用户确认前不开写。

## 写作
- novel_read(brief, for=write)，按结构执行：
  硬约束（世界卡）违反即返工；
  「知道的事 / 不知道的事」= 角色的边界：他只能说他知道的事；
  在场角色三件套(人物卡摘要+当前态+近2-3章经历) = 言行依据；
  非 POV 角色只写可观察的外在言行，不写内心。
- 需要呼应旧章具体描写时 novel_read(chapter) 单点取，不凭印象编。
- 写完汇报三行：字数 / 动用了哪几条伏笔操作 / 有没有偏离 plan。

## 对账（正文写完之后、审过收章之前）
- novel_extract(prepare) → 把素材包作为一次性任务委派 subagent → 拿回 JSON
  → novel_extract(import)。
- 汇报格式：计划命中 ✓×n / 计划落空 ×n / 自动入库 ×n / 待你确认 ×n，
  附待确认清单与新幽灵卡的一句话摘要。

## 导入已写好的章节
- 用户已有成稿时，按章节顺序逐章：登记 → 对账。章号自动取最大+1，所以先登记的就是第 1 章。
- 稿子已在工作区 \`<画布标题>/第{n}章.md\`：novel_write(chapter, title=…) 只登记，不带 content。
- 稿子贴在对话里：novel_write(chapter, title=…, content=原文)，原文一字不改地转交。
- 每章只对账一次：用户确认正文是定稿再对账；整理出的人物/世界/伏笔落成幽灵卡，等用户在画布上采纳。

## 维护
- 每 3–5 章主动 novel_read(ledger)：沉睡伏笔摆给用户，给建议（下章推/弃置/转设定）。
`
