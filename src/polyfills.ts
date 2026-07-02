// polyfills.ts — browser-global shims for the @hcengineering client libraries when
// they run under Node. This module MUST be imported as the very first line of the
// entry point, before any @hcengineering import, otherwise those modules load first
// and throw «window is not defined» on every tool call (LAB-120).
//
// Why a separate module: ESM hoists and evaluates all `import` statements of a module
// before its body. By importing THIS module first in index.ts, its whole subtree
// (fake-indexeddb/auto + the window stubs below) is evaluated before ./server pulls in
// @hcengineering/*, so `window` already exists by the time those modules load.
//
// Order inside this file is load-bearing:
//   1. `import 'fake-indexeddb/auto'` FIRST. A REAL in-memory indexedDB is required, not
//      a bare stub: createIssue / uploadMarkup push collaborative markup through
//      indexedDB-backed storage and wait for `onsuccess` — a stub hangs forever. Imports
//      evaluate before this module's body, so indexedDB is installed while `window` is
//      still undefined → `auto` lands it on globalThis (not on window). If window already
//      existed, `auto` would attach indexedDB to window and leave globalThis without it.
//   2. window / localStorage / location / addEventListener stubs (module body).
//   3. globalThis.WebSocket ← ws (Node lacks a native WebSocket in the versions we target).

// @ts-ignore — `fake-indexeddb/auto` ships no type declarations for the subpath export.
import 'fake-indexeddb/auto'
import { WebSocket } from 'ws'

const g = globalThis as any

const _ls = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }
const _noop = (): void => {}

g.window = g.window || {
  addEventListener: _noop,
  removeEventListener: _noop,
  dispatchEvent: _noop,
  location: { href: '', protocol: 'https:', host: '' },
  localStorage: _ls,
  navigator: { userAgent: 'node' },
  document: { addEventListener: _noop }
}
g.localStorage = g.localStorage || _ls
g.addEventListener = g.addEventListener || _noop
g.removeEventListener = g.removeEventListener || _noop
g.location = g.location || { href: '', protocol: 'https:', host: '' }
if (g.indexedDB != null && g.window.indexedDB == null) g.window.indexedDB = g.indexedDB

g.WebSocket = WebSocket
