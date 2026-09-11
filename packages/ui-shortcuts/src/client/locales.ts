/** `shortcuts` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'shortcuts'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'settings.title': '快捷键',
  'settings.description': '点击键帽自定义键位或鼠标键',
  'settings.expand': '展开快捷键设置',
  'settings.collapse': '收起快捷键设置',
  'action.pause': '暂停当前任务',
  'action.pause.desc': '中断当前会话正在运行的任务（等同停止按钮）',
  'action.steerSend': '插队发送',
  'action.steerSend.desc': '将当前草稿以插队方式发送',
  'action.newSession': '新建会话',
  'action.newSession.desc': '创建新会话（等同新会话按钮）',
  'action.compact': '压缩上下文',
  'action.compact.desc': '压缩当前会话历史（等同 /compact 命令）',
  'action.toggleSidebar': '开关侧边栏',
  'action.toggleSidebar.desc': '展开或收起左侧边栏（等同侧边栏的收起按钮）',
  'gesture.middle': '中键',
  'gesture.right': '右键',
  'unbound': '未绑定',
  'binding.hint': '点击录制新键位或鼠标键',
  'capturing': '按下新键位或鼠标键…',
  'capture.hint': 'Esc 取消 · Delete 解绑 · 中键/右键可直录',
  'reset': '恢复默认',
  'default': '默认：{binding}',
}

/** English dictionary (validated against the zh key set). */
export const en = {
  'settings.title': 'Keyboard shortcuts',
  'settings.description': 'Click a keycap to rebind to a key or mouse button',
  'settings.expand': 'Expand keyboard shortcuts',
  'settings.collapse': 'Collapse keyboard shortcuts',
  'action.pause': 'Pause current task',
  'action.pause.desc': 'Interrupts the running turn (same as the Stop button)',
  'action.steerSend': 'Send with priority',
  'action.steerSend.desc': 'Sends the current draft with priority',
  'action.newSession': 'New session',
  'action.newSession.desc': 'Starts a new session (same as the New-session button)',
  'action.compact': 'Compact context',
  'action.compact.desc': 'Compacts this session history (same as the /compact command)',
  'action.toggleSidebar': 'Toggle sidebar',
  'action.toggleSidebar.desc': 'Expands or collapses the left sidebar (same as its collapse control)',
  'gesture.middle': 'Middle',
  'gesture.right': 'Right',
  'unbound': 'Unbound',
  'binding.hint': 'Click to record a new key or mouse button',
  'capturing': 'Press a key or mouse button…',
  'capture.hint': 'Esc to cancel · Delete to unbind · middle/right click records directly',
  'reset': 'Reset',
  'default': 'Default: {binding}',
} satisfies Record<ShortcutKey, string>

/** Shortcut dictionary keys. */
export type ShortcutKey = keyof typeof zh
