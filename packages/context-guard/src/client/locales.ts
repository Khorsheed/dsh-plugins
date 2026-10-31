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
  'member.compacting': '压缩中…',
  'member.dot': '{name} 的上下文超过提醒比例',
  'member.ratio': '此成员的提醒比例',
  'member.ratio.followHarness': '留空跟随 {harness} 的比例（{ratio}）',
  'member.ratio.followGlobal': '留空跟随提醒比例（{ratio}）',
  'settings.cli.title': '外部 CLI',
  'settings.cli.hint': '房间成员和 CLI 会话用这里的比例；留空跟随上面的提醒比例。',
  'settings.cli.follow': '跟随 {ratio}',
  'settings.members.title': '单独设置比例的成员',
  'settings.members.clear': '清除',
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
  'member.compacting': 'Compacting…',
  'member.dot': '{name} is past its reminder ratio',
  'member.ratio': 'This member\'s reminder ratio',
  'member.ratio.followHarness': 'Empty follows {harness}\'s ratio ({ratio})',
  'member.ratio.followGlobal': 'Empty follows the reminder ratio ({ratio})',
  'settings.cli.title': 'External CLIs',
  'settings.cli.hint': 'Room members and CLI sessions use these ratios; empty follows the reminder ratio above.',
  'settings.cli.follow': 'Follows {ratio}',
  'settings.members.title': 'Members with their own ratio',
  'settings.members.clear': 'Clear',
} satisfies Record<string, string>
