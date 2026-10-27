#!/usr/bin/env node
// Writes the zip to upload: dist/notebook-viewer.zip, made from inside the
// package folder so panel.json sits at the zip's root.
//
//   npm run package
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { LIMITS, listFiles, packageDir, zipPackage, zipPath } from './lib/dist.mjs'

if (!existsSync(packageDir)) {
  console.error(`package: ${packageDir} does not exist. Run "npm run build" first.`)
  process.exit(1)
}

const files = await listFiles(packageDir)
const zip = await zipPackage(packageDir, files)

if (zip.length > LIMITS.zippedBytes) {
  console.error(`package: ${(zip.length / 1024 / 1024).toFixed(2)} MB zipped, the limit is 5 MB.`)
  process.exit(1)
}

await writeFile(zipPath, zip)
console.log(`package: ${files.length} files, ${(zip.length / 1024 / 1024).toFixed(2)} MB → ${zipPath}`)
