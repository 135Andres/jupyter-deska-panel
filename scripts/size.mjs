#!/usr/bin/env node
// The size budget: 5 MB zipped, 20 MB unpacked, 500 files, only the file types
// Deska accepts. Fails when the package goes over any of them.
//
//   node scripts/size.mjs [package folder]
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { FILE_TYPES, LIMITS, extensionOf, listFiles, packageDir, zipPackage } from './lib/dist.mjs'

const dir = resolve(process.argv[2] ?? packageDir)
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

if (!existsSync(dir)) {
  console.error(`size: ${dir} does not exist. Run "npm run build" first.`)
  process.exit(1)
}

const files = await listFiles(dir)
const unpacked = files.reduce((sum, file) => sum + file.size, 0)
const zipped = (await zipPackage(dir, files)).length
const problems = []

for (const file of files) {
  const ext = extensionOf(file.path)
  if (!FILE_TYPES.includes(ext)) problems.push(`${file.path}: .${ext || '(none)'} is not a file type a package may carry.`)
}
if (files.length > LIMITS.files) problems.push(`${files.length} files, the limit is ${LIMITS.files}.`)
if (unpacked > LIMITS.unpackedBytes) problems.push(`${mb(unpacked)} unpacked, the limit is ${mb(LIMITS.unpackedBytes)}.`)
if (zipped > LIMITS.zippedBytes) problems.push(`${mb(zipped)} zipped, the limit is ${mb(LIMITS.zippedBytes)}.`)

console.log(`size: ${files.length} files, ${mb(unpacked)} unpacked, ${mb(zipped)} zipped (${dir})`)

if (problems.length) {
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}
console.log('  ✓ within the budget')
