// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { McpServerManageModal } from '../src/client/McpServerManageModal.tsx'
import { ToolDetailModal } from '../src/client/ToolDetailModal.tsx'
import type { CatalogToolRow } from '../src/types.ts'
import type { McpGroup } from '../src/client/mcp-model.ts'

afterEach(cleanup)

const parameters = {
  type: 'object',
  properties: { orderId: { type: 'string', description: 'Order to bind' } },
  required: ['orderId'],
}

describe('MCP parameter detail', () => {
  it('passes a discovered schema through the server list to the tool detail', () => {
    let opened: CatalogToolRow | undefined
    const group: McpGroup = {
      serverName: 'mcd-mcp', transport: 'streamable-http', enabled: true, managed: true,
      config: { serverName: 'mcd-mcp', transport: 'streamable-http', url: 'https://example.invalid/mcp', enabled: true },
      tools: [{ name: 'auto-bind-coupons', description: 'Bind coupons', parameters, enabled: true }],
      liveTools: [], credentials: [], toolCount: 1,
    }
    const view = render(<McpServerManageModal
      group={group}
      discovering={false}
      onClose={vi.fn()}
      onSetEnabled={async () => {}}
      onSetCredential={async () => true}
      onSetToolEnabled={async () => {}}
      onDiscover={async () => {}}
      onOpenTool={tool => { opened = tool }}
      t={key => key}
    />)
    fireEvent.click(view.getByText('auto-bind-coupons'))
    view.unmount()
    expect(opened?.parameters).toEqual(parameters)

    const detail = render(<ToolDetailModal tool={opened!} onClose={vi.fn()} t={key => key} />)
    expect(detail.container.textContent).toContain('orderId')
    expect(detail.container.textContent).toContain('Order to bind')
    expect(detail.container.textContent).toContain('string')
    expect(detail.container.textContent).not.toContain('toolNoParams')
  })
})

describe('MCP server detail toggle', () => {
  const renderModal = (group: McpGroup, onSetEnabled: (serverName: string, enabled: boolean) => Promise<void> = async () => {}) => render(<McpServerManageModal
    group={group}
    discovering={false}
    onClose={vi.fn()}
    onSetEnabled={onSetEnabled}
    onSetCredential={async () => true}
    onSetToolEnabled={async () => {}}
    onDiscover={async () => {}}
    onOpenTool={() => {}}
    t={key => key}
  />)

  it('disables an enabled managed server without duplicate submissions', async () => {
    let finish: (() => void) | undefined
    const onSetEnabled = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const view = renderModal({
      serverName: 'mcd-mcp', transport: 'streamable-http', enabled: true, managed: true,
      config: { serverName: 'mcd-mcp', transport: 'streamable-http', enabled: true },
      tools: [], liveTools: [], credentials: [], toolCount: 0,
    }, onSetEnabled)
    const toggle = view.getByRole('checkbox', { name: 'mcpEnabled: mcd-mcp' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(view.getByText('mcpEnabled')).toBeTruthy()

    fireEvent.click(toggle)
    expect(onSetEnabled).toHaveBeenCalledWith('mcd-mcp', false)
    expect(toggle.disabled).toBe(true)
    fireEvent.click(toggle)
    expect(onSetEnabled).toHaveBeenCalledTimes(1)

    await act(async () => { finish?.() })
    expect(toggle.disabled).toBe(false)
  })

  it('enables a disabled managed server', () => {
    const onSetEnabled = vi.fn(async () => {})
    const view = renderModal({
      serverName: 'mcd-mcp', transport: 'streamable-http', enabled: false, managed: true,
      config: { serverName: 'mcd-mcp', transport: 'streamable-http', enabled: false },
      tools: [], liveTools: [], credentials: [], toolCount: 0,
    }, onSetEnabled)
    const toggle = view.getByRole('checkbox', { name: 'mcpEnabled: mcd-mcp' }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    expect(view.getByText('mcpDisabled')).toBeTruthy()

    fireEvent.click(toggle)
    expect(onSetEnabled).toHaveBeenCalledWith('mcd-mcp', true)
  })

  it('renders no operable toggle for a live-only server', () => {
    const view = renderModal({
      serverName: 'external-mcp', transport: undefined, enabled: true, managed: false,
      config: undefined, tools: [],
      liveTools: [{ name: 'external-tool', description: 'External tool', channel: 'mcp', confidence: 'exact', serverName: 'external-mcp' }],
      credentials: [], toolCount: 1,
    })

    expect(view.queryByRole('checkbox')).toBeNull()
  })
})
