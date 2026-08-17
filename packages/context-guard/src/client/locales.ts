/** `context-guard` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'button.label': '压缩',
  'button.warning.aria': '上下文即将占满（{percent}%，含输出预算）—— 点击压缩历史以释放空间',
  'button.warning.title': '上下文 {percent}%（含 {maxTokens} 输出预算）已达阈值 —— 点击执行 /compact 压缩历史',
  'button.overdue.aria': '上下文 + 输出预算已超出窗口（{percent}%）—— 主请求会被拒绝，点击执行 /compact',
  'button.overdue.title': '上下文 + 输出预算已达 {percent}%，请求会被拒绝 —— 点击执行 /compact',
  'button.error': '压缩未执行',
  'settings.title': '压缩按钮时机',
  'settings.description': '调整压缩按钮何时出现；只影响按钮时机，不影响官方自动压缩',
  'settings.expand': '展开',
  'settings.collapse': '收起',
  'settings.field.threshold': '阈值比例',
  'settings.field.threshold.hint': 'context + 输出预算 达到窗口的该比例时显示按钮（0.01–1）',
  'settings.field.maxTokens': '输出预算 maxTokens',
  'settings.field.maxTokens.hint': '下一个请求预留的输出 token 数；判定精度取决于 catalog 的 contextWindow 与 provider 真实窗口的接近程度，配小是保守（提前告警），宁小勿大',
  'settings.overridden': '已自定义',
  'settings.reset': '重置',
  'settings.save': '保存',
  'settings.discard': '放弃',
  'settings.saved': '已保存',
  'settings.error': '保存失败，请重试',
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
  'button.overdue.aria': 'Context + output budget exceeds the window ({percent}%) — the main request will be rejected; click to run /compact',
  'button.overdue.title': 'Context + output budget is at {percent}%, requests will be rejected — click to run /compact',
  'button.error': 'Compaction was not executed',
  'settings.title': 'Compact button timing',
  'settings.description': 'Tune when the compact button appears; only the button timing, never the official auto-compaction',
  'settings.expand': 'Expand',
  'settings.collapse': 'Collapse',
  'settings.field.threshold': 'Threshold ratio',
  'settings.field.threshold.hint': 'Show the button once context + output budget reaches this fraction of the window (0.01–1)',
  'settings.field.maxTokens': 'Output budget maxTokens',
  'settings.field.maxTokens.hint': 'Tokens the next request reserves for output; precision depends on how close the catalog contextWindow is to the provider\'s real window — smaller is conservative (earlier warning), prefer smaller over larger',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset',
  'settings.save': 'Save',
  'settings.discard': 'Discard',
  'settings.saved': 'Saved',
  'settings.error': 'Save failed, please retry',
} satisfies Record<string, string>
