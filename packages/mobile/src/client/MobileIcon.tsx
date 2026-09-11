export type MobileIconName = 'members' | 'back' | 'settings' | 'compose' | 'folder' | 'search' | 'scan' | 'close' | 'down' | 'right' | 'plus' | 'attachment' | 'commands' | 'shield'
const paths: Record<MobileIconName, string> = {
  members: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8 .13a4 4 0 0 1 0 7.75',
  plus: 'M12 5v14M5 12h14', commands: 'm16 4-8 16', shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  attachment: 'm9 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8M7 14l7-7a1 1 0 0 1 2 2l-7 7',
  back: 'm15 18-6-6 6-6', settings: 'M4 7h6m4 0h6M4 17h10m4 0h2M10 4v6m4 4v6',
  compose: 'M12 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M10 14l1-4 8-8 3 3-8 8-4 1Z',
  folder: 'M3 7a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z',
  search: 'm16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  scan: 'M8 4H5a1 1 0 0 0-1 1v3m12-4h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3m8 0h3a1 1 0 0 0 1-1v-3M5 12h14',
  close: 'm6 6 12 12M6 18 18 6', down: 'm6 9 6 6 6-6', right: 'm9 6 6 6-6 6',
}
export function MobileIcon({ name, size = 22 }: { name: MobileIconName; size?: number }) {
  return <svg data-mobile-icon={name} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>
}
