/** `room` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.newRoom': '新建 Room',
  'view.members': '成员',
  'members.empty': '暂无成员',
} satisfies Record<string, string>

/** The room namespace key union. */
export type RoomKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The room controls' copy. */
    room: RoomKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.newRoom': 'New room',
  'view.members': 'Members',
  'members.empty': 'No members yet',
} satisfies Record<RoomKey, string>
