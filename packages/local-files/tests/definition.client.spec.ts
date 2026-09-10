/**
 * The right-Sidebar tab type definition: identity, page shape (no address
 * claims, extension band), and the guide entry that names the browser 文件列表
 * / Files against the official workspace-scoped files card.
 */
import { describe, expect, it } from 'vitest'
import {
  LOCAL_FILES_KIND, LOCAL_FILES_TAB_ID, localFilesDefinition,
} from '../src/client/definition.tsx'

const t = (key: string): string => `t:${key}`

describe('localFilesDefinition', () => {
  it('registers as a page type under the package identity, claiming no address', () => {
    const definition = localFilesDefinition(t)
    expect(definition.id).toBe(LOCAL_FILES_TAB_ID)
    expect(definition.kind).toBe(LOCAL_FILES_KIND)
    expect(definition.patterns).toBeUndefined()
    expect(definition.priority).toBeUndefined()
    expect(definition.title('sidebar://local-files')).toBe('t:tab.label')
  })

  it('offers one guide entry parked after the built-in cards', () => {
    const definition = localFilesDefinition(t)
    expect(definition.guide?.length).toBe(1)
    const entry = definition.guide![0]!
    expect(entry.order).toBe(40)
    expect(entry.title()).toBe('t:tab.label')
    expect(entry.description()).toBe('t:guide.description')
    expect(entry.icon).toBeTypeOf('function')
  })
})
