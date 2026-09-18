/** `quote` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu.title': '引用',
  'menu.quoteToConversation': '引用到当前会话',
  'menu.quoteToSideChat': '引用到侧边对话',
  'menu.copy': '复制',

  'quote.attribution': '—— 引用自「{label}」',
  'source.fallback': '选区',
}

/** English dictionary (same key set). */
export const en: Record<keyof typeof zh, string> = {
  'menu.title': 'Quote',
  'menu.quoteToConversation': 'Quote to current chat',
  'menu.quoteToSideChat': 'Quote to side chat',
  'menu.copy': 'Copy',

  'quote.attribution': '— quoted from “{label}”',
  'source.fallback': 'Selection',
}

/** The dictionary namespace this view binds. */
export const NS = 'quote'

/** The quote namespace key union (`zh` is the key-set source of truth). */
export type QuoteKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The selection quote menu copy. */
    'quote': QuoteKey
  }
}
