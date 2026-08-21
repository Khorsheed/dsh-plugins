/** `context-guard` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'button.label': '压缩',
  'button.aria': '上下文已用 {percent}%，点击压缩历史',
  'button.error': '压缩未执行',
  'settings.title': '压缩提醒时机',
  'settings.description': '上下文占用达到设定比例时，输入框出现压缩按钮',
  'settings.expand': '展开',
  'settings.collapse': '收起',
  'settings.field.threshold': '提醒比例',
  'settings.field.threshold.hint': '上下文占用达到窗口的该比例时显示压缩按钮；可配置范围 0.01–1，按自己的偏好调整即可',
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
  'button.aria': 'Context at {percent}%, click to compact history',
  'button.error': 'Compaction was not executed',
  'settings.title': 'Compaction reminder timing',
  'settings.description': 'Shows the compact button in the composer once context occupancy reaches the configured fraction',
  'settings.expand': 'Expand',
  'settings.collapse': 'Collapse',
  'settings.field.threshold': 'Reminder ratio',
  'settings.field.threshold.hint': 'Show the compact button once context occupancy reaches this fraction of the window; configurable from 0.01 to 1 — tune it to your preference',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset',
  'settings.save': 'Save',
  'settings.discard': 'Discard',
  'settings.saved': 'Saved',
  'settings.error': 'Save failed, please retry',
} satisfies Record<string, string>
