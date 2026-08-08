// stdout-guard.ts — keeps stdout clean for the MCP JSON-RPC framing.
//
// The @hcengineering client libraries log progress with plain `console.log`, which in
// Node goes to **stdout** — the same pipe the stdio transport uses for JSON-RPC. Every
// such line lands in the host's parser as garbage, e.g.
//   MCP huly: Unexpected token 'C', "Connected "... is not valid JSON
//   MCP huly: Unexpected token 'C', "Client: onConnect 1" is not valid JSON
// Known offenders: @hcengineering/core/lib/client.js ("Client: onConnect"),
// @hcengineering/client-resources/lib/connection.js ("Connected to server:",
// "Generate new SessionId", "no ping response…", "Processing upgrade") and
// client-resources/lib/index.js ("init DB complete").
//
// We cannot patch vendored code, so we move every stdout-bound console method to stderr.
// The logs stay visible (hosts surface MCP stderr), they just stop corrupting the stream.
//
// This module MUST be the very first import of the entry point — ahead of ./polyfills and
// anything that pulls in @hcengineering — because some of those lines are emitted during
// module init, not only at connect time.

const toStderr = (...args: unknown[]): void => {
  // console.error writes to stderr; using it keeps Node's normal formatting/inspection.
  console.error(...args)
}

for (const method of ['log', 'info', 'debug', 'dir', 'table', 'group', 'groupEnd'] as const) {
  ;(console as unknown as Record<string, unknown>)[method] = toStderr
}

export {}
