// @vitest-environment jsdom
/**
 * The settings card's MODE control and its scope-editor honesty.
 *
 * Three claims are pinned here, all of them things a reader sees:
 *
 * 1. the mode control sits beside the search/sort controls and offers every
 *    preset plus the comparison;
 * 2. the comparison reads every mode's face once, shows which modes load a
 *    capability, and a chip jumps into that mode;
 * 3. a skill the deployment CANNOT scope (a plugin-provided one) shows why
 *    instead of a checkerboard whose Save the host refuses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { CapabilityCatalogCard, scopeEditorFor } from '../src/client/CapabilityCatalogCard.tsx'
import type { CapabilityCatalogCardProps } from '../src/client/slots.ts'
import type {
  CapabilityCatalogSnapshot, CatalogModeFace, CatalogPresetOption, CatalogPresetScopeStatus, CatalogSkillRow, CatalogToolRow,
} from '../src/types.ts'

afterEach(cleanup)

const t = ((key: string) => en[key as keyof typeof en] ?? key) as CapabilityCatalogCardProps['t']

const roster: readonly CatalogPresetOption[] = [
  { id: 'standard', name: '标准模式', isDefault: true },
  { id: 'minimal', name: '极简模式' },
]

const scopeStatus: CatalogPresetScopeStatus = {
  enabled: true,
  root: '/home/user/.dsh/skills',
  watching: true,
  skills: [],
  presets: [],
  customRootsUnverifiable: true,
}

/** One managed skill's delivery status row. */
function managedRow(name: string, presets: readonly string[], extra: { readonly conflict?: string } = {}) {
  return {
    name,
    description: `${name} description`,
    modelInvocable: true,
    userInvocable: true,
    path: `/home/user/.dsh/capability-catalog/skills/${name}/SKILL.md`,
    presets,
    delivered: presets.length > 0,
    ...extra,
  }
}

function skillRow(name: string, source = 'runtime', provider = 'inline-html-render'): CatalogSkillRow {
  return { name, description: `${name} description`, source, provider, modelInvocable: true, userInvocable: true }
}

function toolRow(name: string): CatalogToolRow {
  return { name, description: `${name} description`, channel: 'plugin', confidence: 'exact' }
}

/** One card over a fixed snapshot, with every write path a spy. */
function renderCard(options: {
  readonly skills?: readonly CatalogSkillRow[]
  readonly tools?: readonly CatalogToolRow[]
  readonly faces?: readonly CatalogModeFace[]
  readonly roster?: readonly CatalogPresetOption[]
  readonly status?: CatalogPresetScopeStatus
  readonly detail?: CapabilityCatalogCardProps['detail']
  readonly readSkillFile?: CapabilityCatalogCardProps['readSkillFile']
} = {}) {
  const snapshot: CapabilityCatalogSnapshot = {
    skills: options.skills ?? [skillRow('3d-artifact')],
    tools: options.tools ?? [toolRow('list_capabilities')],
    mcpServers: [],
    channels: [],
    preset: 'standard',
  }
  const refresh = vi.fn(async () => undefined)
  const modeFaces = vi.fn(async () => options.faces ?? [])
  const props = {
    useCatalog: (selector: (value: CapabilityCatalogSnapshot | undefined) => unknown) => selector(snapshot),
    refresh,
    refreshSettled: vi.fn(async () => true),
    detail: options.detail ?? vi.fn(async (name: string) => ({
      name, description: 'detail description', source: 'runtime', provider: 'inline-html-render',
      modelInvocable: true, userInvocable: true, content: '# skill',
    })),
    readSkillFile: options.readSkillFile ?? vi.fn(async () => undefined),
    listDirSkills: vi.fn(async () => []),
    setCredential: vi.fn(async () => true),
    addSkill: vi.fn(async () => ({ ok: true })),
    deleteSkill: vi.fn(async () => ({ ok: true })),
    pickDirectory: vi.fn(async () => null),
    modeFaces,
    mcpSnapshot: vi.fn(async () => ({ servers: [], tools: {}, credentials: [] })),
    mcpAdd: vi.fn(async () => true),
    mcpRemove: vi.fn(async () => true),
    mcpSetEnabled: vi.fn(async () => undefined),
    mcpSetCredential: vi.fn(async () => true),
    mcpSetToolEnabled: vi.fn(async () => undefined),
    mcpDiscover: vi.fn(async () => []),
    presetScopeStatus: vi.fn(async () => options.status ?? scopeStatus),
    presetScopeRoster: vi.fn(async () => options.roster ?? roster),
    presetScopeSet: vi.fn(async () => ({ ok: true })),
    presetScopeAdopt: vi.fn(async () => ({ ok: true })),
    presetScopeRelease: vi.fn(async () => ({ ok: true })),
    t,
  } as unknown as CapabilityCatalogCardProps
  render(<CapabilityCatalogCard {...props} />)
  return { refresh, modeFaces, props }
}

/** The mode control, once the roster has landed. */
async function modeSelect(): Promise<HTMLSelectElement> {
  return await screen.findByLabelText(t('modeLabel')) as HTMLSelectElement
}

describe('the mode control', () => {
  it('lists every preset, marks the default, and offers the comparison', async () => {
    renderCard()
    const select = await modeSelect()
    const labels = [...select.options].map(option => option.textContent)
    expect(labels).toEqual([`标准模式（${en.modeDefault}）`, '极简模式', t('modeAll')])
    expect(select.value).toBe('standard')
  })

  it('reads the chosen mode instead of the default one', async () => {
    const { refresh } = renderCard()
    const select = await modeSelect()
    fireEvent.change(select, { target: { value: 'minimal' } })
    await waitFor(() => expect(refresh).toHaveBeenCalledWith('minimal'))
  })

  it('keeps the mode control in a mode that holds nothing', async () => {
    // The control lives in the filter bar: hiding the bar for an empty mode
    // would strand the reader in a mode they cannot leave from this tab.
    const { refresh } = renderCard({ skills: [], tools: [] })
    const select = await modeSelect()
    fireEvent.change(select, { target: { value: 'standard' } })
    await waitFor(() => expect(refresh).toHaveBeenCalledWith('standard'))
    expect(screen.getByText(t('empty'))).toBeTruthy()
  })

  it('renders no control when the deployment supplies no roster', async () => {
    const props = {
      useCatalog: (selector: (value: CapabilityCatalogSnapshot | undefined) => unknown) => selector(undefined),
      refresh: vi.fn(async () => undefined), refreshSettled: vi.fn(async () => true),
      detail: vi.fn(async () => undefined), readSkillFile: vi.fn(async () => undefined), listDirSkills: vi.fn(async () => []),
      setCredential: vi.fn(async () => true), addSkill: vi.fn(async () => ({ ok: true })),
      deleteSkill: vi.fn(async () => ({ ok: true })), pickDirectory: vi.fn(async () => null),
      modeFaces: vi.fn(async () => []), mcpSnapshot: vi.fn(async () => ({ servers: [], tools: {}, credentials: [] })),
      mcpAdd: vi.fn(async () => true), mcpRemove: vi.fn(async () => true), mcpSetEnabled: vi.fn(async () => undefined),
      mcpSetCredential: vi.fn(async () => true), mcpSetToolEnabled: vi.fn(async () => undefined),
      mcpDiscover: vi.fn(async () => []),
      presetScopeStatus: vi.fn(async () => undefined), presetScopeRoster: vi.fn(async () => []),
      presetScopeSet: vi.fn(async () => ({ ok: true })), presetScopeAdopt: vi.fn(async () => ({ ok: true })),
      presetScopeRelease: vi.fn(async () => ({ ok: true })),
      t,
    } as unknown as CapabilityCatalogCardProps
    render(<CapabilityCatalogCard {...props} />)
    await waitFor(() => expect(screen.getByText(t('loading'))).toBeTruthy())
    expect(screen.queryByLabelText(t('modeLabel'))).toBeNull()
  })
})

describe('the comparison view', () => {
  const faces: readonly CatalogModeFace[] = [
    { preset: 'standard', name: '标准模式', isDefault: true, skills: [skillRow('3d-artifact')], tools: [toolRow('list_capabilities')] },
    { preset: 'minimal', name: '极简模式', isDefault: false, skills: [], tools: [toolRow('list_capabilities')] },
  ]

  it('reads every mode once and attributes each capability to the modes that load it', async () => {
    const { modeFaces } = renderCard({ faces })
    fireEvent.change(await modeSelect(), { target: { value: '\u0000compare' } })
    expect(await screen.findByText(/Compared 2 modes/)).toBeTruthy()
    expect(modeFaces).toHaveBeenCalledTimes(1)
    // The skill exists in one mode only: its chip row names just that mode.
    expect(screen.getAllByRole('button', { name: '标准模式' }).length).toBe(1)
    expect(screen.queryAllByRole('button', { name: '极简模式' })).toEqual([])
    // The tool exists in both, and the tools tab shows both chips.
    fireEvent.click(screen.getByRole('tab', { name: /Tools/i }))
    expect(await screen.findByRole('button', { name: '极简模式' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '标准模式' }).length).toBeGreaterThan(0)
  })

  it('jumps into a mode from its chip', async () => {
    const { refresh } = renderCard({ faces })
    fireEvent.change(await modeSelect(), { target: { value: '\u0000compare' } })
    await screen.findByText(/Compared 2 modes/)
    fireEvent.click(screen.getByRole('tab', { name: /Tools/i }))
    fireEvent.click(await screen.findByRole('button', { name: '极简模式' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledWith('minimal'))
    expect((await modeSelect()).value).toBe('minimal')
  })

  it('marks a card with a chip row, so the row owns the card\'s bottom padding', async () => {
    // The row is card BODY content (the button above cannot pad it), so the card
    // hands its bottom padding over exactly when the row renders — the contract
    // the stylesheet keys on. An empty list must not claim it.
    const { modeFaces } = renderCard({ faces })
    expect(document.querySelector('[data-modes]')).toBeNull()
    fireEvent.change(await modeSelect(), { target: { value: '\u0000compare' } })
    await screen.findByText(/Compared 2 modes/)
    expect(document.querySelectorAll('[data-modes="true"]').length).toBeGreaterThan(0)
    expect(modeFaces).toHaveBeenCalledTimes(1)
  })

  it('reports a mode it could not read instead of showing an empty face', async () => {
    const { modeFaces } = renderCard({
      faces: [
        { preset: 'standard', name: '标准模式', isDefault: true, skills: [], tools: [] },
        { preset: 'broken', name: '坏模式', isDefault: false, skills: [], tools: [], unavailable: 'not valid YAML' },
      ],
    })
    fireEvent.change(await modeSelect(), { target: { value: '\u0000compare' } })
    expect(await screen.findByText(/1 mode\(s\) could not be read/)).toBeTruthy()
    expect(modeFaces).toHaveBeenCalledTimes(1)
  })

  it('collapses a capability every mode loads into one summary pill', async () => {
    const many = [
      { preset: 'standard', name: '标准模式', isDefault: true, skills: [skillRow('everywhere')], tools: [] },
      { preset: 'minimal', name: '极简模式', isDefault: false, skills: [skillRow('everywhere')], tools: [] },
      { preset: 'ptc', name: 'PTC 模式', isDefault: false, skills: [skillRow('everywhere')], tools: [] },
    ]
    const wide = [
      { id: 'standard', name: '标准模式', isDefault: true },
      { id: 'minimal', name: '极简模式' },
      { id: 'ptc', name: 'PTC 模式' },
    ]
    renderCard({ faces: many, roster: wide, skills: [skillRow('everywhere')] })
    fireEvent.change(await modeSelect(), { target: { value: '\u0000compare' } })
    expect(await screen.findByText(en.modeEvery.replace('{n}', '3'))).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: '标准模式' })).toEqual([])
  })

  it('collapses the overflow of a partial mode list behind +N, expanding in place', async () => {
    const many = [
      { preset: 'standard', name: '标准模式', isDefault: true, skills: [skillRow('most')], tools: [] },
      { preset: 'minimal', name: '极简模式', isDefault: false, skills: [skillRow('most')], tools: [] },
      { preset: 'ptc', name: 'PTC 模式', isDefault: false, skills: [skillRow('most')], tools: [] },
      { preset: 'cordis', name: '创造模式', isDefault: false, skills: [skillRow('only-elsewhere')], tools: [] },
    ]
    const wide = [
      { id: 'standard', name: '标准模式', isDefault: true },
      { id: 'minimal', name: '极简模式' },
      { id: 'ptc', name: 'PTC 模式' },
      { id: 'cordis', name: '创造模式' },
    ]
    renderCard({ faces: many, roster: wide, skills: [skillRow('most')] })
    fireEvent.change(await modeSelect(), { target: { value: '\u0000compare' } })
    const more = await screen.findByRole('button', { name: en.modeMore.replace('{n}', '1') })
    expect(screen.queryByRole('button', { name: 'PTC 模式' })).toBeNull()
    fireEvent.click(more)
    expect(await screen.findByRole('button', { name: 'PTC 模式' })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.modeCollapse })).toBeTruthy()
  })
})

describe('the mode grid', () => {
  const withWriting = [
    { id: 'standard', name: '标准模式', isDefault: true },
    { id: 'dsh-writing', name: '写作模式' },
  ]

  it('shows only what the selected mode loads', async () => {
    // The delivery-scoped skill is delivered to 写作模式 only: it must not appear
    // in 开发模式's grid (the defect: a management merge put it there).
    renderCard({
      roster: withWriting,
      status: { ...scopeStatus, skills: [managedRow('md-to-wechat', ['dsh-writing'])] },
    })
    const select = await modeSelect()
    fireEvent.change(select, { target: { value: 'standard' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: /md-to-wechat/ })).toBeNull())
    expect(screen.getByRole('button', { name: /3d-artifact/ })).toBeTruthy()
    // It is not an orphan either: selecting its own mode reaches it.
    expect(screen.queryByText(/load in no mode/)).toBeNull()
  })

  it('lists a managed skill no mode can load, so it stays releasable', async () => {
    renderCard({
      roster: withWriting,
      status: { ...scopeStatus, skills: [managedRow('md-to-wechat', ['dsh-writing-renamed'])] },
    })
    expect(await screen.findByText(en.orphanManaged.replace('{n}', '1'))).toBeTruthy()
    expect(await screen.findByRole('button', { name: /md-to-wechat/ })).toBeTruthy()
  })

  it('keeps the source badge on grid cards instead of the preset scope', async () => {
    renderCard({
      roster: withWriting,
      skills: [skillRow('coding-helper', 'user-dsh')],
    })
    expect(await screen.findByText(en.sourceUser)).toBeTruthy()
    expect(screen.queryByText(/^preset · /)).toBeNull()
  })
})

describe('the source browser', () => {
  /** A detail read whose skill carries one bundle file beside SKILL.md. */
  const detailWithFiles = () => vi.fn(async (name: string) => ({
    name, description: 'd', source: 'runtime', provider: 'inline-html-render',
    modelInvocable: true, userInvocable: true, content: '# skill',
    files: ['SKILL.md', 'notes.md'],
  }))

  it('reads a bundle file at the preset the detail was opened from', async () => {
    const detail = detailWithFiles()
    const readSkillFile = vi.fn(async () => ({ content: 'file body' }))
    renderCard({ detail, readSkillFile })
    fireEvent.change(await modeSelect(), { target: { value: 'minimal' } })
    fireEvent.click(await screen.findByRole('button', { name: /3d-artifact/ }))
    await waitFor(() => expect(detail).toHaveBeenCalledWith('3d-artifact', 'minimal'))
    fireEvent.click(await screen.findByText(en.viewSource))
    fireEvent.click(await screen.findByRole('button', { name: 'notes.md' }))
    await waitFor(() => expect(readSkillFile).toHaveBeenCalledWith('3d-artifact', 'notes.md', 'minimal'))
  })

  it('reads a bundle file at the mode that actually loads the skill in the compare view', async () => {
    const detail = detailWithFiles()
    const readSkillFile = vi.fn(async () => ({ content: 'file body' }))
    renderCard({
      detail,
      readSkillFile,
      faces: [
        { preset: 'standard', name: '标准模式', isDefault: true, skills: [], tools: [] },
        { preset: 'minimal', name: '极简模式', isDefault: false, skills: [skillRow('3d-artifact')], tools: [] },
      ],
    })
    fireEvent.change(await modeSelect(), { target: { value: ' compare' } })
    await screen.findByText(/Compared 2 modes/)
    fireEvent.click(await screen.findByRole('button', { name: /3d-artifact/ }))
    // The comparison reads where the capability lives: only 极简模式 has it.
    await waitFor(() => expect(detail).toHaveBeenCalledWith('3d-artifact', 'minimal'))
    fireEvent.click(await screen.findByText(en.viewSource))
    fireEvent.click(await screen.findByRole('button', { name: 'notes.md' }))
    await waitFor(() => expect(readSkillFile).toHaveBeenCalledWith('3d-artifact', 'notes.md', 'minimal'))
  })
})

describe('the scope editor', () => {
  it('shows why a plugin-provided skill cannot be scoped, and where it does load', async () => {
    const { modeFaces } = renderCard({
      skills: [skillRow('3d-artifact', 'runtime', 'inline-html-render')],
      faces: [
        { preset: 'standard', name: '标准模式', isDefault: true, skills: [skillRow('3d-artifact')], tools: [] },
        { preset: 'minimal', name: '极简模式', isDefault: false, skills: [], tools: [] },
      ],
    })
    fireEvent.click(await screen.findByRole('button', { name: /3d-artifact/ }))
    expect(await screen.findByText(en.scopeProvided.replace('{provider}', 'inline-html-render'))).toBeTruthy()
    expect(screen.queryByText(en.scopeSave)).toBeNull()
    // The modes that carry it, read once from the shared faces cache.
    expect(await screen.findByRole('button', { name: '标准模式' })).toBeTruthy()
    expect(modeFaces).toHaveBeenCalledTimes(1)
  })

  it('says so when no mode loads a non-writable skill', async () => {
    renderCard({
      skills: [skillRow('orphan-plugin-skill', 'runtime', 'inline-html-render')],
      faces: [{ preset: 'standard', name: '标准模式', isDefault: true, skills: [], tools: [] }],
    })
    fireEvent.click(await screen.findByRole('button', { name: /orphan-plugin-skill/ }))
    expect(await screen.findByText(en.modeNone)).toBeTruthy()
  })

  it('keeps the checkbox grid and Save for a skill in the managed root', async () => {
    const managed: CatalogPresetScopeStatus = {
      ...scopeStatus,
      skills: [{ name: '3d-artifact', description: 'd', modelInvocable: true, userInvocable: true, path: '/home/user/.dsh/skills/3d-artifact/SKILL.md', presets: ['minimal'], delivered: true }],
    }
    const props = {
      useCatalog: (selector: (value: CapabilityCatalogSnapshot | undefined) => unknown) =>
        selector({ skills: [skillRow('3d-artifact', 'user-dsh')], tools: [], mcpServers: [], channels: [], preset: 'standard' }),
      refresh: vi.fn(async () => undefined), refreshSettled: vi.fn(async () => true),
      detail: vi.fn(async (name: string) => ({
        name, description: 'd', source: 'user-dsh', provider: 'filesystem', modelInvocable: true, userInvocable: true, content: '# skill',
      })),
      readSkillFile: vi.fn(async () => undefined), listDirSkills: vi.fn(async () => []),
      setCredential: vi.fn(async () => true), addSkill: vi.fn(async () => ({ ok: true })),
      deleteSkill: vi.fn(async () => ({ ok: true })), pickDirectory: vi.fn(async () => null),
      modeFaces: vi.fn(async () => []), mcpSnapshot: vi.fn(async () => ({ servers: [], tools: {}, credentials: [] })),
      mcpAdd: vi.fn(async () => true), mcpRemove: vi.fn(async () => true), mcpSetEnabled: vi.fn(async () => undefined),
      mcpSetCredential: vi.fn(async () => true), mcpSetToolEnabled: vi.fn(async () => undefined), mcpDiscover: vi.fn(async () => []),
      presetScopeStatus: vi.fn(async () => managed), presetScopeRoster: vi.fn(async () => roster),
      presetScopeSet: vi.fn(async () => ({ ok: true })), presetScopeAdopt: vi.fn(async () => ({ ok: true })),
      presetScopeRelease: vi.fn(async () => ({ ok: true })),
      t,
    } as unknown as CapabilityCatalogCardProps
    render(<CapabilityCatalogCard {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: /3d-artifact/ }))
    expect(await screen.findByText(en.scopeSave)).toBeTruthy()
    // One action only: the managed-root mechanics (adopt/release) never surface.
    expect(screen.getAllByRole('button', { name: en.scopeSave })).toHaveLength(1)
    expect(screen.queryByText(en.scopeProvided.replace('{provider}', 'inline-html-render'))).toBeNull()
  })

  it('adopts with one Save: the pick is the scope', async () => {
    const { props } = renderCard({ skills: [skillRow('coding-helper', 'user-dsh')] })
    fireEvent.click(await screen.findByRole('button', { name: /coding-helper/ }))
    // Empty pick = every preset: Save stays disabled until a subset is picked.
    const save = await screen.findByRole('button', { name: en.scopeSave })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(await screen.findByRole('checkbox', { name: '极简模式' }))
    expect((save as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(props.presetScopeAdopt).toHaveBeenCalledWith('coding-helper', ['minimal']))
    expect(props.presetScopeSet).not.toHaveBeenCalled()
    expect(props.presetScopeRelease).not.toHaveBeenCalled()
  })

  it('releases with one Save when a managed skill\'s pick is emptied', async () => {
    const { props } = renderCard({
      skills: [skillRow('md-to-wechat', 'user-dsh')],
      status: { ...scopeStatus, skills: [managedRow('md-to-wechat', ['minimal'])] },
    })
    fireEvent.click(await screen.findByRole('button', { name: /md-to-wechat/ }))
    const box = await screen.findByRole('checkbox', { name: '极简模式' })
    expect((box as HTMLInputElement).checked).toBe(true)
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: en.scopeSave }))
    await waitFor(() => expect(props.presetScopeRelease).toHaveBeenCalledWith('md-to-wechat'))
    expect(props.presetScopeSet).not.toHaveBeenCalled()
    expect(props.presetScopeAdopt).not.toHaveBeenCalled()
  })
})

describe('scopeEditorFor', () => {
  const actions = {
    save: async () => ({ ok: true }),
    adopt: async () => ({ ok: true }),
    release: async () => ({ ok: true }),
  }

  it('is absent when the deployment has no delivery surface', () => {
    expect(scopeEditorFor('x', [skillRow('x')], null, roster, actions)).toBeUndefined()
  })

  it('is not writable for a plugin-provided skill, and names the plugin', () => {
    const editor = scopeEditorFor('x', [skillRow('x', 'runtime', 'inline-html-render')], scopeStatus, roster, actions)
    expect(editor).toMatchObject({ managed: false, adoptable: false, writable: false, provider: 'inline-html-render' })
  })

  it('is writable and adoptable for a user-level skill', () => {
    const editor = scopeEditorFor('x', [skillRow('x', 'user-dsh')], scopeStatus, roster, actions)
    expect(editor).toMatchObject({ managed: false, adoptable: true, writable: true })
  })

  it('is writable for a managed skill and carries its declared presets', () => {
    const status: CatalogPresetScopeStatus = {
      ...scopeStatus,
      skills: [{ name: 'x', description: 'd', modelInvocable: true, userInvocable: true, path: '/home/user/skills/x/SKILL.md', presets: ['standard'], delivered: true }],
    }
    const editor = scopeEditorFor('x', [], status, roster, actions)
    expect(editor).toMatchObject({ managed: true, writable: true, declared: ['standard'] })
  })

  it('routes apply: adopt for an unmanaged pick, re-scope for a managed one, release when emptied', async () => {
    const calls: string[] = []
    const routed = {
      save: async (presets: readonly string[]) => { calls.push(`save:${presets.join(',')}`); return { ok: true } },
      adopt: async (presets: readonly string[]) => { calls.push(`adopt:${presets.join(',')}`); return { ok: true } },
      release: async () => { calls.push('release'); return { ok: true } },
    }
    const unmanaged = scopeEditorFor('x', [skillRow('x', 'user-dsh')], scopeStatus, roster, routed)!
    await unmanaged.apply(['standard'])
    // An empty pick on an unmanaged skill is already the truth: no write.
    expect(await unmanaged.apply([])).toEqual({ ok: true })
    const status: CatalogPresetScopeStatus = {
      ...scopeStatus,
      skills: [managedRow('x', ['standard'])],
    }
    const managed = scopeEditorFor('x', [], status, roster, routed)!
    await managed.apply(['minimal'])
    await managed.apply([])
    expect(calls).toEqual(['adopt:standard', 'save:minimal', 'release'])
  })
})
