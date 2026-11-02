#!/usr/bin/env node
// Runs the package checks from the examples repository over our package folder:
// the same manifest and file rules Deska applies when a folder is loaded.
//
//   npm run validate:deska [-- package folder]
//
// The checks live in the examples repository, so point this at a clone of
// https://github.com/0xPasho/deska-panels-examples with
// DESKA_PANELS_EXAMPLES_DIR (a relative path or an absolute one, your choice).
// Its default is a sibling folder next to this repository.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { AGENT_NOTICE, packageDir, repoRoot } from './lib/dist.mjs'
import { checkAgent, DOCS, usesAgent } from './validate-agent.mjs'

const examplesDir = resolve(repoRoot, process.env.DESKA_PANELS_EXAMPLES_DIR ?? '../deska-panels-examples')
const libPath = resolve(examplesDir, 'tools/lib/manifest.mjs')
const dir = resolve(process.argv[2] ?? packageDir)

if (!existsSync(libPath)) {
  console.error(`validate:deska: no package checks at ${libPath}.`)
  console.error('Clone https://github.com/0xPasho/deska-panels-examples and set DESKA_PANELS_EXAMPLES_DIR to it.')
  process.exit(1)
}

if (!existsSync(dir)) {
  console.error(`validate:deska: ${dir} does not exist. Run "npm run build" first.`)
  process.exit(1)
}

// The examples repository does not know sdk 4 or agent: see lib/waive-hooks.mjs.
let manifest
try { manifest = JSON.parse(readFileSync(resolve(dir, 'panel.json'), 'utf8')) } catch { /* the package checks report it */ }
if (usesAgent(manifest)) {
  console.warn(`validate:deska: ! ${AGENT_NOTICE}`)
  register('./lib/waive-hooks.mjs', import.meta.url)
}

const { checkPanelFolder } = await import(pathToFileURL(libPath).href)
const result = await checkPanelFolder(dir)
const agentErrors = manifest === undefined ? [] : checkAgent(manifest)

if (!result.ok || agentErrors.length) {
  console.error(`validate:deska: ${dir} would be refused.`)
  for (const error of result.errors ?? []) console.error(`  ✗ ${error}`)
  for (const error of agentErrors) console.error(`  ✗ ${error}`)
  if (agentErrors.length) console.error(`  See ${DOCS}`)
  process.exit(1)
}

console.log(`validate:deska: ${result.manifest.id} passes (${result.files.length} files, ${dir})`)
for (const warning of result.warnings) console.warn(`  ! ${warning}`)
