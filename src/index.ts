#!/usr/bin/env node
// MUST be first: moves console.log/info/debug off stdout, which the stdio transport owns
// for JSON-RPC. The @hcengineering libs log there and corrupt the stream otherwise
// («Unexpected token 'C', "Connected "... is not valid JSON»).
import './stdout-guard'
// Then: installs window/indexedDB/WebSocket shims before any @hcengineering
// module loads, otherwise every tool call throws «window is not defined» (LAB-120).
import './polyfills'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server'
import { closeConnection } from './connection'

async function main (): Promise<void> {
  const server = createServer()
  const transport = new StdioServerTransport()

  process.on('SIGINT', async () => {
    await closeConnection()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    await closeConnection()
    process.exit(0)
  })

  await server.connect(transport)
  // Process stays alive — connection maintained until shutdown
}

main().catch((err) => {
  console.error('Fatal error starting huly-mcp:', err)
  process.exit(1)
})
