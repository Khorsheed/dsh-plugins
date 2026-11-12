import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

function createFixtureServer(): McpServer {
  const server = new McpServer({ name: 'catalog-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.registerTool('add', {
    description: 'Add two numbers',
    inputSchema: z.object({ a: z.number(), b: z.number() }),
  }, async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }))
  server.registerTool('credential', {
    description: 'Read the test credential supplied through the host',
    inputSchema: z.object({}),
  }, async () => ({ content: [{ type: 'text', text: process.env.FIXTURE_TOKEN ?? 'missing' }] }))
  server.registerTool('admin.reset', {
    description: 'A dotted MCP name',
    inputSchema: z.object({}),
  }, async () => ({ content: [{ type: 'text', text: 'reset' }] }))
  return server
}

serveStdio(createFixtureServer, { onerror: error => { console.error('catalog MCP fixture:', error) } })
