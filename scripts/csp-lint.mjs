#!/usr/bin/env node
// The bundle must run under Deska's policy, which has no 'unsafe-eval', no
// worker or WebAssembly source. Fails when the package holds code the sandbox
// refuses.
//
//   node scripts/csp-lint.mjs [package folder]
//
// See https://deska.dev/docs/panel-sandbox.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { extensionOf, listFiles, packageDir } from './lib/dist.mjs'

const FORBIDDEN = [
  { name: 'eval(', pattern: /\beval\s*\(/ },
  { name: 'new Function', pattern: /\bnew\s+Function\b/ },
  { name: 'importScripts', pattern: /\bimportScripts\s*\(/ },
  { name: 'new Worker', pattern: /\bnew\s+Worker\b/ },
  { name: 'WebAssembly', pattern: /\bWebAssembly\b/ },
]

const SCRIPTED = ['html', 'js', 'mjs']

const dir = resolve(process.argv[2] ?? packageDir)

if (!existsSync(dir)) {
  console.error(`csp-lint: ${dir} does not exist. Run "npm run build" first.`)
  process.exit(1)
}

const files = (await listFiles(dir)).filter((file) => SCRIPTED.includes(extensionOf(file.path)))
const problems = []

for (const file of files) {
  const text = await readFile(join(dir, file.path), 'utf8')
  const lines = text.split('\n')
  for (const { name, pattern } of FORBIDDEN) {
    for (const [index, line] of lines.entries()) {
      if (!pattern.test(line)) continue
      const at = line.search(pattern)
      const snippet = line.slice(Math.max(0, at - 40), at + 60).trim()
      problems.push(`${file.path}:${index + 1}: ${name} — …${snippet}…`)
    }
  }
}

console.log(`csp-lint: ${files.length} script files checked (${dir})`)

if (problems.length) {
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}
console.log('  ✓ nothing the sandbox refuses')
