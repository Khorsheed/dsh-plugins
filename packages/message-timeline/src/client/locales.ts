/** `message-timeline` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'rail.panel': '消息导览',
  'rail.empty': '无文本预览',
  'rail.turn': '第 {turn} 轮',
  'rail.image': '图片消息',
  'rail.attachment': '附件消息',
} satisfies Record<string, string>

/** The message-timeline namespace key union. */
export type TimelineKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The message timeline panel's copy. */
    'message-timeline': TimelineKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'rail.panel': 'Message timeline',
  'rail.empty': 'No text preview',
  'rail.turn': 'Turn {turn}',
  'rail.image': 'Image message',
  'rail.attachment': 'Attachment message',
} satisfies Record<TimelineKey, string>
