#!/usr/bin/env node
'use strict'
// Restores the TypeScript declarations that @hcengineering packages promise but no longer ship.
//
// Their package.json says `"types": "types/index.d.ts"`, yet the 0.7.4xx tarballs contain no
// `types/` directory at all — verified with `npm pack`:
//     @hcengineering/core@0.7.423 → 0 files under package/types/
//     @hcengineering/core@0.7.413 → 0
//     @hcengineering/core@0.7.26  → 88   ← last version that shipped them
// An upstream publish bug, not a local prune and not npm's `omit=dev`.
//
// Without this, `tsc` reported ~60 errors (TS7016 «could not find a declaration file», then a
// cascade of TS7006 implicit-any) — and still EMITTED, because the build does not use
// noEmitOnError. That is the dangerous part: a genuine type error would have been invisible in
// the noise, and dist/ would ship anyway.
//
// Downgrading the runtime is not an option (the self-hosted server is 0.7.423, and api-client /
// account-client only exist on that line), so we graft the declarations from the last version
// that published them. Compiling the whole codebase against them yields 0 errors, i.e. the API
// surface we touch did not drift.
//
// Idempotent: packages whose `types/` is present are skipped, so the day upstream publishes
// declarations again this becomes a no-op and the file can be deleted.

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

// package → last version that actually shipped `types/`
const SOURCES = {
  core: '0.7.26',
  platform: '0.7.20',
  'account-client': '0.7.25',
  analytics: '0.7.19'
}

const root = path.resolve(__dirname, '..')
const missing = Object.keys(SOURCES).filter((pkg) => {
  const dir = path.join(root, 'node_modules', '@hcengineering', pkg)
  return fs.existsSync(dir) && !fs.existsSync(path.join(dir, 'types'))
})

if (missing.length === 0) {
  console.error('[restore-types] nothing to do — all declarations present')
  process.exit(0)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hce-types-'))
let failed = 0

for (const pkg of missing) {
  const spec = `@hcengineering/${pkg}@${SOURCES[pkg]}`
  try {
    // --pack-destination keeps the tarball out of the repo; the filename is the last stdout line.
    const out = execFileSync('npm', ['pack', spec, '--pack-destination', tmp], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const tarball = path.join(tmp, out.trim().split('\n').pop().trim())
    const unpacked = fs.mkdtempSync(path.join(tmp, 'x-'))
    execFileSync('tar', ['xzf', tarball, '-C', unpacked])

    const src = path.join(unpacked, 'package', 'types')
    if (!fs.existsSync(src)) throw new Error(`${spec} has no types/ either`)

    const dest = path.join(root, 'node_modules', '@hcengineering', pkg, 'types')
    fs.cpSync(src, dest, { recursive: true })
    console.error(`[restore-types] ${pkg} ← ${SOURCES[pkg]} (${fs.readdirSync(dest).length} files)`)
  } catch (err) {
    failed++
    console.error(`[restore-types] FAILED for ${spec}: ${err.message}`)
  }
}

fs.rmSync(tmp, { recursive: true, force: true })

// Never fail `npm install` over this — a broken build is louder and easier to diagnose than a
// broken install, and offline installs are a legitimate case.
if (failed > 0) console.error('[restore-types] some packages stayed untyped — `npm run build` will be noisy')
