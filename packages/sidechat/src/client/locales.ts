/** `sidechat` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.label': '侧边对话',
  'guide.description': '围绕当前上下文的随身 Agent——引用几条消息问两句',

  'state.loading': '加载中…',
  'state.empty': '围绕当前会话问点什么，或从消息动作的「引用到侧边对话」带一条过来',
  'state.hostMissing': '宿主未安装侧边对话的宿主半边',

  'status.new': '新对话',
  'status.cold': '待唤醒',
  'status.idle': '空闲',
  'status.running': '思考中…',

  'refs.title': '引用（{count}）',
  'refs.collapse': '收起',

  'context.switch': '切换上下文',
  'context.unread': '有新回复',

  'dock.open': '弹出为浮层',
  'dock.backToTab': '回到侧栏 tab',
  'dock.readonly': '只读：没有选中的会话',

  'composer.placeholder': '问点什么…（⌘⏎ 发送）',
  'composer.send': '发送',

  'tool.running': '调用工具 {name} …',
  'tool.done': '工具 {name} 完成',
  'tool.error': '工具 {name} 出错',

  'action.quote': '引用到侧边对话',
  'action.quoted': '已引用',
  'action.quoteFailed': '引用失败',

  'error.send': '发送失败：{message}',
  'error.unknown': '未知错误',

  'markdown.copy': '复制',
  'markdown.copied': '已复制',
  'markdown.footnotes': '脚注',
}

/** English dictionary (same key set). */
export const en: Record<keyof typeof zh, string> = {
  'tab.label': 'Side chat',
  'guide.description': 'A companion Agent around the current context — quote a few messages and ask',

  'state.loading': 'Loading…',
  'state.empty': 'Ask about the current conversation, or bring a message over with “Quote to side chat”',
  'state.hostMissing': 'The side chat host half is not installed',

  'status.new': 'New chat',
  'status.cold': 'Asleep',
  'status.idle': 'Idle',
  'status.running': 'Thinking…',

  'refs.title': 'Refs ({count})',
  'refs.collapse': 'Collapse',

  'context.switch': 'Switch context',
  'context.unread': 'New replies',

  'dock.open': 'Pop out as a floating dock',
  'dock.backToTab': 'Back to the sidebar tab',
  'dock.readonly': 'Read-only: no session selected',

  'composer.placeholder': 'Ask something… (⌘⏎ sends)',
  'composer.send': 'Send',

  'tool.running': 'Calling tool {name}…',
  'tool.done': 'Tool {name} finished',
  'tool.error': 'Tool {name} failed',

  'action.quote': 'Quote to side chat',
  'action.quoted': 'Quoted',
  'action.quoteFailed': 'Quote failed',

  'error.send': 'Send failed: {message}',
  'error.unknown': 'Unknown error',

  'markdown.copy': 'Copy',
  'markdown.copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
}

/** The dictionary namespace this view binds. */
export const NS = 'sidechat'

/** The sidechat namespace key union (`zh` is the key-set source of truth). */
export type SideChatKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The side chat tab and quote-action copy. */
    'sidechat': SideChatKey
  }
}
