/** `quote` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu.title': '引用',
  'menu.quoteToConversation': '引用到当前会话',
  'menu.quoteToSideChat': '引用到侧边对话',
  'menu.copy': '复制',

  'quote.attribution': '—— 引用自「{label}」',
  'quote.attributionAt': '—— 引用自「{label}」（{ref}）',
  'quote.attributionBare': '—— 引用',
  'quote.location': '位置：{ref}',
  'chip.label': '引用「{label}」',
  'card.source': '引用自「{label}」',
  'preview.close': '关闭',
  'preview.location': '位置',
}

/** English dictionary (same key set). */
export const en: Record<keyof typeof zh, string> = {
  'menu.title': 'Quote',
  'menu.quoteToConversation': 'Quote to current chat',
  'menu.quoteToSideChat': 'Quote to side chat',
  'menu.copy': 'Copy',

  'quote.attribution': '— quoted from “{label}”',
  'quote.attributionAt': '— quoted from “{label}” ({ref})',
  'quote.attributionBare': '— quoted',
  'quote.location': 'Location: {ref}',
  'chip.label': 'Quote “{label}”',
  'card.source': 'Quoted from “{label}”',
  'preview.close': 'Close',
  'preview.location': 'Location',
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
