#!/usr/bin/env node
// Previews the built package in the examples repository's preview host, which
// serves it with Deska's policy and plays Deska's side of the bridge.
//
//   npm run preview:deska
//
// The host takes the folder as an argument, so the package can live outside
// the examples repository. Point DESKA_PANELS_EXAMPLES_DIR at a clone of
// https://github.com/0xPasho/deska-panels-examples (relative or absolute).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { packageDir, repoRoot } from './lib/dist.mjs'

const examplesDir = resolve(repoRoot, process.env.DESKA_PANELS_EXAMPLES_DIR ?? '../deska-panels-examples')
const server = resolve(examplesDir, 'tools/preview/server.mjs')

if (!existsSync(server)) {
  console.error(`preview:deska: no preview host at ${server}.`)
  console.error('Clone https://github.com/0xPasho/deska-panels-examples and set DESKA_PANELS_EXAMPLES_DIR to it.')
  process.exit(1)
}

if (!existsSync(packageDir)) {
  console.error(`preview:deska: ${packageDir} does not exist. Run "npm run build" first.`)
  process.exit(1)
}

const child = spawn(process.execPath, [server, packageDir, ...process.argv.slice(2)], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
