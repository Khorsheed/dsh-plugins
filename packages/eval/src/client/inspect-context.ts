/**
 * The lab's one way to open 查看 (T86): the tab body provides the opener,
 * any page under it asks for it. Null outside a lab tab (a page rendered in a
 * spec on its own), so every entry degrades to its inline form.
 */
import { createContext, useContext } from 'react'
import type { InspectTarget } from './inspect-target.ts'

/** Open a target in the sidebar, or in the page's own Sheet when there is none. */
export type OpenInspect = (target: InspectTarget) => void

/** The opener the lab tab provides. */
export const InspectContext = createContext<OpenInspect | null>(null)

/** The opener, or null outside a lab tab. */
export function useInspect(): OpenInspect | null {
  return useContext(InspectContext)
}
