/** `context-guard` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'button.label': '压缩',
  'button.warning.aria': '上下文即将占满（{percent}%，含输出预算）—— 点击压缩历史以释放空间',
  'button.warning.title': '上下文 {percent}%（含 {maxTokens} 输出预算）已达阈值 —— 点击执行 /compact 压缩历史',
  'button.overdue.aria': '上下文已超出长度（{percent}%）—— 压缩可能已无法执行，点击仍可尝试',
  'button.overdue.title': '上下文 + 输出预算已达 {percent}%，请求会被拒绝 —— 点击尝试 /compact',
  'button.error': '压缩未执行',
} satisfies Record<string, string>

/** The context-guard namespace key union. */
export type ContextGuardKey = keyof typeof zh

/** The dictionary namespace owned by this plugin. */
export const NS = 'context-guard'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The context-guard compact button's copy. */
    'context-guard': ContextGuardKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'button.label': 'compact',
  'button.warning.aria': 'Context nearly full ({percent}%, output budget included) — click to compact history and free space',
  'button.warning.title': 'Context {percent}% (incl. {maxTokens} output budget) crossed the threshold — click to run /compact on history',
  'button.overdue.aria': 'Context already exceeds the window ({percent}%) — compaction may no longer run, click to try anyway',
  'button.overdue.title': 'Context + output budget is at {percent}%, requests will be rejected — click to try /compact',
  'button.error': 'Compaction was not executed',
} satisfies Record<string, string>
