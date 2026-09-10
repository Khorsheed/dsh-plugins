/**
 * The right-Sidebar tab type definition: identity, page shape (no address
 * claims, extension band), the kind takeover of the official files type, and
 * the guide entry that names the browser 文件列表 / Files.
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
    // The kind is the official files type's own: the extension band takes the
    // builtin kind over (the registry's designed shadowing), so the guide
    // lists one files card — ours.
    expect(definition.kind).toBe('files')
    expect(LOCAL_FILES_KIND).toBe('files')
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
