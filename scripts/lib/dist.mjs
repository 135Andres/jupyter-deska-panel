// Shared by the package scripts: what a package is, and how it is listed and zipped.
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
export const packageDir = resolve(repoRoot, 'dist/notebook-viewer')
export const zipPath = resolve(repoRoot, 'dist/notebook-viewer.zip')

// Deska's package limits: https://deska.dev/docs/panel-manifest
export const LIMITS = {
  zippedBytes: 5 * 1024 * 1024,
  unpackedBytes: 20 * 1024 * 1024,
  files: 500,
}

// The only file types a package may carry.
export const FILE_TYPES = ['html', 'js', 'mjs', 'css', 'json', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'woff2', 'md', 'txt']

/** Every file under `dir`, as paths relative to it. Dotfiles are skipped. */
export async function listFiles(dir, base = '') {
  const out = []
  for (const entry of await readdir(join(dir, base), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...(await listFiles(dir, rel)))
    else out.push({ path: rel, size: (await stat(join(dir, rel))).size })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** The package as one zip, with every path at its root. */
export async function zipPackage(dir, files) {
  const entries = {}
  for (const file of files) entries[file.path] = new Uint8Array(await readFile(join(dir, file.path)))
  return zipSync(entries)
}

/** The extension of a package file, without the dot, lowercased. */
export function extensionOf(path) {
  return extname(path).slice(1).toLowerCase()
}

/** The warning shown when the examples repository's sdk and agent errors are ignored. */
export const AGENT_NOTICE = [
  'This manifest uses sdk 4 and agent. The examples repository\'s validator only knows sdk 1,',
  'so its errors "sdk must be 1", "Unknown field agent" and "Unknown permission agent" are ignored.',
  'Every other error still fails. The agent rules are checked by scripts/validate-agent.mjs.',
  'Docs: https://deska.dev/docs/panel-manifest and https://deska.dev/docs/panel-actions',
].join('\n  ')
