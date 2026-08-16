/** `message-timeline` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'rail.toggle': '消息导览',
  'rail.toggleAria': '{open, plural, =true {收起消息导览} other {展开消息导览}}',
  'rail.empty': '暂无用户消息',
} satisfies Record<string, string>

/** The message-timeline namespace key union. */
export type TimelineKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The message timeline rail's copy. */
    'message-timeline': TimelineKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'rail.toggle': 'Message timeline',
  'rail.toggleAria': '{open, plural, =true {Collapse the message timeline} other {Expand the message timeline}}',
  'rail.empty': 'No user messages',
} satisfies Record<TimelineKey, string>
