/** `shortcuts` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'shortcuts'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'settings.title': '快捷键',
  'settings.description': '点击键帽自定义键位',
  'action.pause': '暂停当前任务',
  'action.pause.desc': '中断当前会话正在运行的任务（等同停止按钮）',
  'action.steerSend': '插队发送',
  'action.steerSend.desc': '将当前草稿以插队方式发送',
  'action.newSession': '新建会话',
  'action.newSession.desc': '创建新会话（等同新会话按钮）',
  'unbound': '未绑定',
  'binding.hint': '点击录制新键位',
  'capturing': '按下新键位…',
  'capture.hint': 'Esc 取消 · Delete 解绑',
  'reset': '恢复默认',
  'default': '默认：{binding}',
}

/** English dictionary (validated against the zh key set). */
export const en = {
  'settings.title': 'Keyboard shortcuts',
  'settings.description': 'Click a keycap to rebind',
  'action.pause': 'Pause current task',
  'action.pause.desc': 'Interrupts the running turn (same as the Stop button)',
  'action.steerSend': 'Send with priority',
  'action.steerSend.desc': 'Sends the current draft with priority',
  'action.newSession': 'New session',
  'action.newSession.desc': 'Starts a new session (same as the New-session button)',
  'unbound': 'Unbound',
  'binding.hint': 'Click to record a new key',
  'capturing': 'Press a key…',
  'capture.hint': 'Esc to cancel · Delete to unbind',
  'reset': 'Reset',
  'default': 'Default: {binding}',
} satisfies Record<ShortcutKey, string>

/** Shortcut dictionary keys. */
export type ShortcutKey = keyof typeof zh
