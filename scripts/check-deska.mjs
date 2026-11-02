#!/usr/bin/env node
// Builds the package, links it into the examples repository's panels/ folder,
// runs its check (manifest, preview host, no console errors) and removes the
// link again, even when the check fails.
//
//   npm run check:deska
//
// Needs a clone of https://github.com/0xPasho/deska-panels-examples
// (DESKA_PANELS_EXAMPLES_DIR, default: a sibling folder).
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, rmSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { packageDir, repoRoot } from './lib/dist.mjs'

const examplesDir = resolve(repoRoot, process.env.DESKA_PANELS_EXAMPLES_DIR ?? '../deska-panels-examples')
const checkScript = resolve(examplesDir, 'tools/check.mjs')
if (!existsSync(checkScript)) {
  console.error(`check:deska: no check at ${checkScript}.`)
  console.error('Clone https://github.com/0xPasho/deska-panels-examples and set DESKA_PANELS_EXAMPLES_DIR to it.')
  process.exit(1)
}

const build = spawnSync('npx', ['vite', 'build'], { cwd: repoRoot, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)

const link = resolve(examplesDir, 'panels/notebook-viewer')
const exists = () => { try { lstatSync(link); return true } catch { return false } }
if (exists()) {
  if (!lstatSync(link).isSymbolicLink()) {
    console.error(`check:deska: ${link} exists and is not a link; refusing to touch it.`)
    process.exit(1)
  }
  rmSync(link)
}

let status
try {
  symlinkSync(packageDir, link, 'dir')
  status = spawnSync(process.execPath, [checkScript, 'notebook-viewer', '--no-shots'], { cwd: examplesDir, stdio: 'inherit' }).status ?? 1
} finally {
  if (exists()) rmSync(link)
}
process.exit(status)
