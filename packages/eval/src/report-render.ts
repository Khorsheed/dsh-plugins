/**
 * summary.md rendering for the eval report. Pure function of the analyzed
 * {@link EvalReport} — no file access, no clock beyond the generation stamp.
 * Section order follows the task contract: red flags at the very top, the
 * five validity checks next, the negative-criteria hit list among the fact tables
 * (a defect list is a fact, so it prints whether or not comparison is
 * allowed), and comparison sections ONLY when the first four invariants
 * allowed them (facts-only otherwise); a pair the fifth check degraded keeps
 * its per-task table and loses its CI and rank.
 * @module @khorsheed/dsh-eval
 */
import type {
  ConditionEfficiency, CriterionGroupResult, EvalReport, PairComparison, TaskCriteriaTable,
} from './report.ts'
import { RUBRIC_WEIGHTS_PATH } from './weights.ts'

const STATUS_MARK: Record<string, string> = { ok: '✅ 成立', violated: '❌ 不成立', unverifiable: '⚠️ 无法核验' }

function fmtNum(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(3)
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60000).toFixed(1)} min`
}

const DASH = '—'

function modelOf(efficiency: ConditionEfficiency): string {
  return efficiency.model ?? DASH
}

function renderPair(comparison: PairComparison): string[] {
  const lines: string[] = []
  lines.push(`### ${comparison.a} vs ${comparison.b}`)
  lines.push('')
  lines.push(`因子: ${comparison.factor.known
    ? (comparison.factor.factor !== null
        ? `单因子 \`${comparison.factor.factor}\`（${comparison.factor.detail}）`
        : `多因子：${comparison.factor.multi?.join('、')}（${comparison.factor.detail}）`)
    : comparison.factor.detail}`)
  lines.push('')
  if (comparison.perTask.length === 0) {
    lines.push('无配对题（两条件的题集不相交）。')
    lines.push('')
    return lines
  }
  const weighted = comparison.perTask.some(t => t.aWeighted !== null && t.bWeighted !== null)
  const head = weighted
    ? '| 题 | ' + `${comparison.a} 得分 | ${comparison.b} 得分 | Δ 得分 | ${comparison.a} 加权 | ${comparison.b} 加权 | Δ 加权 | 逐 rep Δ | n |`
    : '| 题 | ' + `${comparison.a} 得分 | ${comparison.b} 得分 | Δ 得分 | 逐 rep Δ | n |`
  lines.push(head)
  lines.push(`|${' --- |'.repeat(head.split('|').length - 2)}`)
  for (const task of comparison.perTask) {
    const delta = task.aMean - task.bMean
    const deltasText = task.deltas.map(fmtNum).join(', ')
    if (weighted) {
      const wDelta = task.aWeighted !== null && task.bWeighted !== null ? fmtNum(task.aWeighted - task.bWeighted) : DASH
      lines.push(`| ${task.task} | ${fmtNum(task.aMean)} | ${fmtNum(task.bMean)} | ${fmtNum(delta)} | ${task.aWeighted === null ? DASH : fmtNum(task.aWeighted)} | ${task.bWeighted === null ? DASH : fmtNum(task.bWeighted)} | ${wDelta} | ${deltasText} | ${task.n} |`)
    } else {
      lines.push(`| ${task.task} | ${fmtNum(task.aMean)} | ${fmtNum(task.bMean)} | ${fmtNum(delta)} | ${deltasText} | ${task.n} |`)
    }
  }
  lines.push('')
  const ci = comparison.ci
  if (ci !== null) {
    lines.push(`平均 Δ = ${fmtNum(ci.mean)}，95% 置信区间 [${fmtNum(ci.lo)}, ${fmtNum(ci.hi)}]（bootstrap 重采样 rep × ${ci.samples}，seed ${ci.seed}）`
      + `${comparison.ciAdvisory ? '——仅供参考，未达排名条件（每题需跑满 3 次）' : ''}。`)
  } else if (comparison.ciWithheld !== null) {
    lines.push(`只有 ${comparison.ciWithheld.tasksWithDelta} 道题有差值，给不出区间。`)
  }
  lines.push(`**名次判定: ${comparison.rankReason}**`)
  lines.push('')
  return lines
}

/**
 * Who judged each cell, and which of those cells were judged by their own
 * model. Decision 9 stopped excluding a judge that is also a player
 * (2026-09-10) and started DISCLOSING it instead, which only works if the
 * report says, per cell, whose opinion the llm-draft numbers are.
 *
 * Rendered inside the comparison section when comparison is allowed — a
 * reader weighing a delta needs it right there — and under 判官一致性
 * otherwise, because "who judged" is a fact about the run and does not stop
 * being one when an invariant refuses the comparison.
 */
function renderJudgeAssignment(report: EvalReport): string[] {
  const lines: string[] = ['**每格由谁判**（决策 9 放宽：判官可与选手同模型，同模型的格标「自评」而不排除）', '']
  if (report.judgeAssignments.length === 0) {
    lines.push('bundle 未记录判官身份——要么本次 run 没有 llm-draft 判定，要么它早于「判定带判官」的版本（不猜，留空）。')
    lines.push('')
    return lines
  }
  lines.push('| 题 | 条件 | rep | 判官（模型 · 采样数） |')
  lines.push('|---|---|---:|---|')
  for (const assignment of report.judgeAssignments) {
    const judges = assignment.judges
      .map(judge => `${judge.condition}（${judge.model ?? DASH} · ${judge.samples > 0 ? `${judge.samples} 采样` : `${judge.verdicts} 判定`}）${judge.selfJudged ? ' **自评**' : ''}`)
      .join('；')
    lines.push(`| ${assignment.task ?? DASH} | ${assignment.condition ?? DASH} | ${assignment.rep ?? DASH} | ${judges} |`)
  }
  const selfJudged = report.judgeAssignments.filter(assignment => assignment.judges.some(judge => judge.selfJudged))
  lines.push('')
  if (selfJudged.length > 0) {
    lines.push(`自评格 ${selfJudged.length} 个：该格的判官模型就是该格选手的模型。公开榜单（MT-Bench / AlpacaEval / Arena-Hard）都测到过模型偏好自己的输出，`
      + '所以这些格的 llm-draft 值**单独读**，不要用来支持含该模型的名次结论。')
  } else {
    lines.push('无自评格：没有任何格的判官模型与该格选手模型相同。')
  }
  lines.push('')
  return lines
}

function renderEfficiency(report: EvalReport): string[] {
  const lines: string[] = []
  if (report.efficiency.length === 0) {
    lines.push('无 orchestrator 委派记录（durationMs / usage 缺失）——效率列全部留空。')
    lines.push('')
    return lines
  }
  lines.push('下表只统计**已完成**的格子（judged / archived / releasable / released）；未完成格子的耗时买到的工作量未知，混进来会让两列看着可比而其实不可比。')
  lines.push('')
  lines.push('| 条件 | 模型 | 活跃时长 | 委派轮次 | 工具调用 | 输出 token | 输入 token | cacheRead | 标价成本 |')
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|')
  for (const efficiency of report.efficiency) {
    lines.push(`| ${[
      efficiency.condition,
      modelOf(efficiency),
      efficiency.activeMs === null ? DASH : fmtMs(efficiency.activeMs),
      efficiency.rounds === null ? DASH : String(efficiency.rounds),
      efficiency.toolCalls === null ? DASH : efficiency.toolCalls.toLocaleString('en-US'),
      efficiency.outputTokens === null ? DASH : efficiency.outputTokens.toLocaleString('en-US'),
      efficiency.inputTokens === null ? DASH : efficiency.inputTokens.toLocaleString('en-US'),
      efficiency.cacheReadTokens === null ? DASH : efficiency.cacheReadTokens.toLocaleString('en-US'),
      efficiency.price === null ? DASH : String(efficiency.price),
    ].join(' | ')} |`)
  }
  lines.push('')
  const models = [...new Set(report.efficiency.map(e => e.model).filter((m): m is string => m !== null))]
  if (models.length > 1) {
    lines.push('token 跨模型**不适用**：上表 token 按条件如实记录，但只在同模型条件之间比较（冻结决策 10）。')
  } else if (models.length === 1) {
    lines.push(`token 口径：各条件同模型（${models[0]}），token 列可比；缓存列按记录如实呈现。`)
  }
  if (report.efficiencyExcluded.length > 0) {
    const excluded = report.efficiencyExcluded
      .map(entry => `${entry.condition} ${entry.state} × ${entry.count}`)
      .join('；')
    const total = report.efficiencyExcluded.reduce((sum, entry) => sum + entry.count, 0)
    lines.push(`未计入上表的未完成格子（${total} 格）: ${excluded}——它们的委派时长如实存在于 results 之外的注解里，只是不进效率口径。`)
  } else {
    lines.push('未计入上表的未完成格子: 无——所有当前格子都已完成。')
  }
  // 工具调用缺席与 0 是两回事：没有 harness 报过计数就打「—」，报过而为 0 才是 0。
  const missingToolCalls = report.efficiency.filter(e => e.rounds !== null && e.toolCalls === null)
  if (missingToolCalls.length > 0) {
    lines.push(`未报工具调用计数的条件: ${missingToolCalls.map(e => e.condition).join('、')}——该列打「${DASH}」而非补零（“没人报过”不是“一次没用”）。`)
  }
  const missingDelegation = report.efficiency.filter(e => e.rounds === null)
  if (missingDelegation.length > 0) {
    lines.push(`无委派记录的条件: ${missingDelegation.map(e => e.condition).join('、')}——轮次/时长留空而非补零。`)
  }
  // 委派轮次只在双方都完成的题上比（未完成可能是早早放弃也可能是耗尽上限，含义相反）。
  for (const factor of report.factors) {
    const roundsOf = (condition: string, task: string): number | null =>
      report.efficiency.find(e => e.condition === condition)?.roundsByTask[task] ?? null
    const both = (report.tasksCompletedBy[factor.a] ?? []).filter(t => (report.tasksCompletedBy[factor.b] ?? []).includes(t))
    if (both.length === 0) {
      lines.push(`委派轮次（${factor.a} vs ${factor.b}）: 无双方都完成的题——不比。`)
      continue
    }
    const parts = both.map((task) => {
      const ra = roundsOf(factor.a, task)
      const rb = roundsOf(factor.b, task)
      return `${task}: ${ra === null ? DASH : fmtNum(ra)} vs ${rb === null ? DASH : fmtNum(rb)}`
    })
    lines.push(`委派轮次（${factor.a} vs ${factor.b}，仅双方都完成的题）: ${parts.join('；')}`)
  }
  lines.push('')
  return lines
}

/**
 * The negative-criteria section: what the polarity table says, and every
 * defect criterion that actually held. The scored count says how many there
 * were; this table is the list a reader comes for.
 */
function renderNegative(report: EvalReport): string[] {
  const lines: string[] = ['## 负向判据命中（缺陷清单）', '']
  const polarity = report.polarity
  if (!polarity.available) {
    lines.push(`**极性未知**：bundle 未带判据权重表（\`${RUBRIC_WEIGHTS_PATH}\`），dataset 层也无 rubric。`)
    lines.push('得分判据数按「全部判据都是正向」计算，负向判据数 **unknown**——本表不代表没有缺陷，只代表无从判断。')
    lines.push('')
    return lines
  }
  lines.push(`极性来源 \`${polarity.origin}\`：${polarity.criteria} 条判据，其中负向 ${polarity.negative} 条。`
    + '负向判据的 `pass: true` 表示缺陷存在——计 0 分，其负 weight 在加权分里自然扣分。')
  lines.push('')
  if (report.negativeHits.length === 0) {
    lines.push('各格最新 attempt 上没有任何负向判据成立。')
    lines.push('')
    return lines
  }
  lines.push('| 题 | 条件 | rep | 判据 | 比例 | weight | ns | 证据 |')
  lines.push('|---|---|---:|---|---:|---:|---|---|')
  for (const hit of report.negativeHits) {
    const ratio = hit.ratio === null ? DASH : `${hit.ratio.passed}/${hit.ratio.total}`
    lines.push(`| ${hit.task ?? DASH} | ${hit.condition ?? DASH} | ${hit.rep ?? DASH} | ${hit.criterion} | ${ratio} | ${hit.weight ?? DASH} | ${hit.ns} | ${hit.evidence.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
  }
  lines.push('')
  return lines
}

/** `31.5k` / `4/6` / a plain integer — §九's number, never a raw float. */
function fmtCredit(cell: CriterionGroupResult): string {
  if (cell.reps === 0) return DASH
  const mark = cell.holds === true ? '✓' : '✗'
  if (cell.proportional) {
    // A proportional criterion's own number IS the answer; a tick over it
    // would round 0.6 to «成立» and lose the whole point of §6.5.
    const proportion = cell.credit === null ? DASH : `${(cell.credit * 100).toFixed(0)}%`
    return cell.reps > 1 ? `${proportion}（${cell.reps} rep 均值）` : proportion
  }
  return cell.reps > 1 ? `${mark} ${cell.heldReps}/${cell.reps}` : mark
}

/** The word for each verdict layer, most authoritative first. */
const SOURCE_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['human-final', '人'], ['llm-draft', '判官'], ['script', '脚本'],
]

/**
 * `人 1 / 判官 3` — where a cell's score came from, per criterion.
 *
 * A cell scored entirely by one layer prints the WORD alone: 「人 4」 on a
 * cell nobody else judged says «four» about nothing a reader asked. The count
 * appears exactly when it carries information — when the layers are mixed,
 * which is the state T54 created and the state that has to be legible.
 * @param sources - layer → criteria that scored from it.
 * @returns the label, or a dash for a cell nothing scored.
 */
export function sourceMixText(sources: Readonly<Record<string, number>>): string {
  const present = SOURCE_WORDS.filter(([ns]) => (sources[ns] ?? 0) > 0)
  if (present.length === 0) return DASH
  if (present.length === 1) return present[0]?.[1] as string
  return present.map(([ns, word]) => `${word} ${String(sources[ns])}`).join(' / ')
}

/**
 * One task's 判据 × 对比组 table, plus the evidence behind it folded away.
 *
 * The table answers «which dimension moved»; the fold answers «on what
 * grounds». Both are facts the bundle already carries — until T54 補一 the
 * summary printed only the per-task totals, and a reader who wanted either
 * had to open results.jsonl and re-do the merge by hand.
 */
function renderCriteriaTable(table: TaskCriteriaTable): string[] {
  const lines: string[] = []
  lines.push(`### ${table.task}`)
  lines.push('')
  if (table.criteria.length === 0 || table.conditions.length === 0) {
    lines.push('本题没有任何判定记录。')
    lines.push('')
    return lines
  }
  const head = `| 判据 | 维度 | weight | 极性 | ${table.conditions.join(' | ')} |`
  lines.push(head)
  lines.push(`|${' --- |'.repeat(head.split('|').length - 2)}`)
  for (const row of table.rows) {
    const facts = table.criteria.find(c => c.id === row.criterion)
    const cells = row.cells.map((cell) => {
      const mix = cell.reps === 0 ? '' : ` <sub>${sourceMixText(cell.sources)}</sub>`
      return `${fmtCredit(cell)}${mix}`
    })
    lines.push(`| ${row.criterion}${facts?.undeclared === true ? ' ⚠️' : ''} | ${facts?.axis ?? DASH} `
      + `| ${facts?.weight ?? DASH} | ${facts?.negative === true ? '负向' : '正向'} | ${cells.join(' | ')} |`)
  }
  // The bottom row is `scoreOf`'s own number, not this table's column sum.
  // The weighted figure appears only when EVERY column has one — the pair
  // table's rule, for the same reason: a blank beside a number reads as zero.
  const weighted = table.totals.length > 0 && table.totals.every(total => total.weighted !== null)
  lines.push(`| **本题总分** | | | | ${table.totals.map(total =>
    `**${total.scored === null ? DASH : fmtNum(total.scored)}**`
    + (weighted && total.weighted !== null ? `（加权 ${fmtNum(total.weighted)}）` : '')
    + ` <sub>${total.reps} rep</sub>`).join(' | ')} |`)
  lines.push('')
  if (table.criteria.some(c => c.undeclared)) {
    lines.push('⚠️ 标记的判据不在 rubric 权重表里——只有判定记录提到它，权重与极性按未声明处理（正向、无权重）。')
    lines.push('')
  }

  const evidence: string[] = []
  for (const row of table.rows) {
    for (const cell of row.cells) {
      for (const sample of [...cell.samples, ...cell.superseded]) {
        const superseded = cell.samples.includes(sample) ? '' : '（已被人工终评改判，原判保留）'
        const judge = sample.judge === null
          ? sample.by
          : `${sample.judge.condition}${sample.judge.model === null ? '' : ` · ${sample.judge.model}`}`
            + `${sample.judge.selfJudged ? ' ⚠️自评' : ''}`
        const ratio = sample.ratio === null ? '' : `（${sample.ratio.passed}/${sample.ratio.total}）`
        evidence.push(`- \`${row.criterion}\` · ${cell.condition} · rep ${sample.rep ?? DASH} · ${sample.ns}`
          + ` · ${sample.pass ? '成立' : '不成立'}${ratio} · ${judge}${superseded}`)
        if (sample.evidence !== '') evidence.push(`  - ${sample.evidence.replace(/\n/g, ' ')}`)
      }
    }
  }
  if (evidence.length > 0) {
    lines.push('<details><summary>判官依据（逐条判定的原文）</summary>')
    lines.push('')
    lines.push(...evidence)
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }
  return lines
}

/** The whole 判据 × 对比组 section — empty when the comparison gate closed it. */
function renderCriteria(report: EvalReport): string[] {
  if (report.criteriaTables.length === 0) return []
  const lines: string[] = ['## 判据 × 对比组（每条判据的得分与判官依据）', '']
  lines.push('格内是该判据在该组的结论：`✓` / `✗` 成立与否（负向判据成立即缺陷），多 rep 写 `成立数/rep 数`，'
    + '按比例给分的判据写比例；下标是这格的**得分来源**——逐判据取最权威层（人 > 判官 > 脚本），同一格可以混合。')
  lines.push('')
  for (const table of report.criteriaTables) lines.push(...renderCriteriaTable(table))
  return lines
}

/** Render the full summary.md. */
export function renderSummaryMd(report: EvalReport): string {
  const lines: string[] = []
  lines.push(`# eval report${report.runId === null ? '' : ` — ${report.runId}`}`)
  lines.push('')
  lines.push(`bundle: \`${report.bundleDir}\``)
  lines.push(`生成时间: ${new Date().toISOString()} · 判定行 ${report.rows.length} · mission ${report.missions} · attempt ${report.attempts}${report.retries > 0 ? `（基础设施重试 ${report.retries} 次，聚合只用各格最新 attempt）` : ''}`)
  lines.push('')

  for (const ns of report.toolOnlyNs) {
    lines.push(`> 🔴 **红字警告：expectedNs 中的 \`${ns}\` 的判定全部由 \`tool:\` 写入——判定来源与该 ns 的契约作者不符，相关结论效力存疑。**`)
    lines.push('')
  }

  lines.push('## 五条有效性校验')
  lines.push('')
  for (const check of report.invariants) {
    lines.push(`- **${check.title}** — ${STATUS_MARK[check.status]}`)
    for (const detail of check.details) lines.push(`  - ${detail}`)
  }
  lines.push('')
  if (!report.comparisonAllowed) {
    lines.push('> **比较未启用：前四条不变量至少一条不成立或无法核验。本报告只输出事实表，不输出比较与名次**（architecture §5）。')
    lines.push('')
  }

  lines.push('## 判定来源（事实）')
  lines.push('')
  const nsCounts = Object.entries(report.nsCounts)
  if (nsCounts.length === 0) {
    lines.push('bundle 中没有任何 verdict 记录。')
  } else {
    lines.push(`| ns | 判定行 |`)
    lines.push(`|---|---:|`)
    for (const [ns, count] of nsCounts.sort()) lines.push(`| ${ns} | ${count} |`)
  }
  if (report.expectedNs !== null) {
    const missing = report.expectedNs.filter(ns => (report.nsCounts[ns] ?? 0) === 0)
    if (missing.length > 0) lines.push(`expectedNs 中缺失的 ns: ${missing.join('、')}（如实缺失，不以其他 ns 顶替）。`)
    else lines.push(`expectedNs（${report.expectedNs.join('、')}）均有记录。`)
  } else {
    lines.push('run.meta 未声明 expectedNs。')
  }
  lines.push('')

  lines.push(...renderNegative(report))

  lines.push('## 条件与因子')
  lines.push('')
  if (report.conditions.length === 0) {
    lines.push('bundle 未记录任何条件（run.meta.conditions 缺失、mission id 无法拆分）——受试对象身份不可考。')
  } else {
    lines.push('| 条件 | sha | 模型 |')
    lines.push('|---|---|---|')
    for (const condition of report.conditions) {
      lines.push(`| ${condition.id} | ${condition.sha === null ? DASH : `\`${condition.sha.slice(0, 12)}…\``} | ${condition.model ?? DASH} |`)
    }
  }
  lines.push('')
  if (report.factors.length > 0) {
    for (const factor of report.factors) {
      lines.push(`- ${factor.a} vs ${factor.b}: ${factor.known
        ? (factor.factor !== null ? `单因子 \`${factor.factor}\`` : `多因子（${factor.multi?.join('、')}）`)
        : '因子未知'} — ${factor.detail}`)
    }
    lines.push('')
  }

  if (report.comparisonAllowed && report.singleCondition) {
    lines.push('## 配对比较')
    lines.push('')
    lines.push('**单条件 run——没有第二个条件可配对，无可比较。** 事实见上表。')
    lines.push('')
  } else if (report.comparisonAllowed && report.comparisons.length > 0) {
    lines.push('## 配对比较（以题为区组）')
    lines.push('')
    lines.push('得分判据数**逐判据**取最权威可用的判定源（human-final > llm-draft > script）——'
      + '人改过的判据用人的，没改的仍用判官的，没判官的用脚本的，同一格的来源可以混合；同判据多样本按多数计；'
      + '正向判据成立计 1，负向判据成立计 0、不成立计 1；带 `ratio` 的按比例给分判据计 passed/total（负向则计其余量）。'
      + '加权分 = Σ weight × 该判据得到的比例，负 weight 自然扣分。'
      + '每条判据取到了哪一层，见下面的「判据 × 对比组」表。')
    lines.push('')
    for (const comparison of report.comparisons) lines.push(...renderPair(comparison))
    lines.push(...renderJudgeAssignment(report))
  }

  lines.push(...renderCriteria(report))

  lines.push('## 判官一致性')
  lines.push('')
  for (const detail of report.judge.details) lines.push(`- ${detail}`)
  lines.push('')
  // The comparison section already carried it when it ran; without one, this
  // is where "who judged" has to live.
  if (!(report.comparisonAllowed && report.comparisons.length > 0 && !report.singleCondition)) {
    lines.push(...renderJudgeAssignment(report))
  }

  lines.push('## 效率（并列，不合成）')
  lines.push('')
  lines.push(...renderEfficiency(report))

  lines.push('## 附注与保留条款')
  lines.push('')
  for (const note of report.notes) lines.push(`- ${note}`)
  lines.push('- 判官/探针本身有误差（独立复核显示判定不一致率可达三成，见题库 dimensions.md）：1–2 条判据的差距不足以下结论。')
  lines.push('- 效率指标并列呈现，不合成单一分数；短不一定好，轮次反映拆解粒度而非工作量。')
  lines.push('- 名次只在前四条不变量成立、这一对判定覆盖一致、每题配对 n ≥ 3 且 95% 置信区间不含 0 时输出；置信区间只在至少 3 道题有差值时给出。')
  lines.push('')
  return `${lines.join('\n')}\n`
}
