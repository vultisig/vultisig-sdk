import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { getTools, type Profile } from './tools.js'
import type { Vault } from './types.js'

export type { AuthAdapter } from './adapters/auth.js'
export { createDefaultAuthAdapter, EnvVarAdapter, FallbackAuthAdapter, LocalKeyringAdapter } from './adapters/auth.js'
export type { SigningAdapter } from './adapters/signing.js'
export { DeferredSigningAdapter, LocalSigningAdapter } from './adapters/signing.js'
export type { Profile, ToolDef } from './tools.js'
export { getToolNames, getTools } from './tools.js'
export type { Vault } from './types.js'

const VERSION = '0.1.0'

export function createMcpServer(vault: Vault, profile: Profile = 'defi'): McpServer {
  const server = new McpServer({
    name: 'vultisig',
    version: VERSION,
  })

  const tools = getTools(vault, profile)

  for (const [name, tool] of Object.entries(tools)) {
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async args => tool.handler(args as Record<string, unknown>)
    )
  }

  return server
}

export async function startMcpServer(vault: Vault, profile: Profile = 'defi'): Promise<void> {
  // MCP stdio requires stdout exclusively for JSON-RPC
  const toStderr = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(' ') + '\n')
  }
  console.log = toStderr
  console.info = toStderr
  console.warn = toStderr

  const server = createMcpServer(vault, profile)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
