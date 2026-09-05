/**
 * summary.md rendering for the eval report. Pure function of the analyzed
 * {@link EvalReport} — no file access, no clock beyond the generation stamp.
 * Section order follows the task contract: red flags at the very top, the
 * four invariants next, and comparison sections ONLY when the invariants
 * allowed them (facts-only otherwise).
 * @module @khorsheed/dsh-eval
 */
import type { ConditionEfficiency, EvalReport, PairComparison } from './report.ts'

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
    ? '| 题 | ' + `${comparison.a} 通过 | ${comparison.b} 通过 | Δ 通过 | ${comparison.a} 加权 | ${comparison.b} 加权 | Δ 加权 | 逐 rep Δ | n |`
    : '| 题 | ' + `${comparison.a} 通过 | ${comparison.b} 通过 | Δ 通过 | 逐 rep Δ | n |`
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
    lines.push(`平均 Δ = ${fmtNum(ci.mean)}，95% 置信区间 [${fmtNum(ci.lo)}, ${fmtNum(ci.hi)}]（bootstrap 重采样 rep × ${ci.samples}，seed ${ci.seed}）。`)
  }
  lines.push(`**名次判定: ${comparison.rankReason}**`)
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
  lines.push('| 条件 | 模型 | 活跃时长 | 委派轮次 | 输出 token | 输入 token | cacheRead | 标价成本 |')
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|')
  for (const efficiency of report.efficiency) {
    lines.push(`| ${[
      efficiency.condition,
      modelOf(efficiency),
      efficiency.activeMs === null ? DASH : fmtMs(efficiency.activeMs),
      efficiency.rounds === null ? DASH : String(efficiency.rounds),
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

  lines.push('## 四条不变量')
  lines.push('')
  for (const check of report.invariants) {
    lines.push(`- **${check.title}** — ${STATUS_MARK[check.status]}`)
    for (const detail of check.details) lines.push(`  - ${detail}`)
  }
  lines.push('')
  if (!report.comparisonAllowed) {
    lines.push('> **比较未启用：至少一条不变量不成立或无法核验。本报告只输出事实表，不输出比较与名次**（architecture §5）。')
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
    lines.push('通过数取各格最权威可用的判定源（human-final > llm-draft > script），同判据多样本按多数计。')
    lines.push('')
    for (const comparison of report.comparisons) lines.push(...renderPair(comparison))
  }

  lines.push('## 判官一致性')
  lines.push('')
  for (const detail of report.judge.details) lines.push(`- ${detail}`)
  lines.push('')

  lines.push('## 效率（并列，不合成）')
  lines.push('')
  lines.push(...renderEfficiency(report))

  lines.push('## 附注与保留条款')
  lines.push('')
  for (const note of report.notes) lines.push(`- ${note}`)
  lines.push('- 判官/探针本身有误差（独立复核显示判定不一致率可达三成，见题库 dimensions.md）：1–2 条判据的差距不足以下结论。')
  lines.push('- 效率指标并列呈现，不合成单一分数；短不一定好，轮次反映拆解粒度而非工作量。')
  lines.push('- 名次只在不变量全部成立且 n ≥ 3 时输出，且以 95% 置信区间是否含 0 为准。')
  lines.push('')
  return `${lines.join('\n')}\n`
}
