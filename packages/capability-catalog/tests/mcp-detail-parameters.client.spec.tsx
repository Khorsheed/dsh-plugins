// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { McpServerManageModal } from '../src/client/McpServerManageModal.tsx'
import { ToolDetailModal } from '../src/client/ToolDetailModal.tsx'
import type { CatalogToolRow } from '../src/types.ts'
import type { McpGroup } from '../src/client/mcp-model.ts'

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
