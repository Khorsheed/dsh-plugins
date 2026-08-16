/** `message-timeline` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'rail.panel': '消息导览',
  'rail.empty': '暂无用户消息',
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
  'rail.empty': 'No user messages',
} satisfies Record<TimelineKey, string>
