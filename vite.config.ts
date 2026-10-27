import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))
const entryRoot = resolve(repoRoot, 'src/app')
const outDir = resolve(repoRoot, 'dist/notebook-viewer')

/**
 * The package folder is `dist/notebook-viewer/`, and Deska wants panel.json at
 * its root. It lives in `panel/` in the repo so it is easy to read and check.
 */
function copyPanelJson() {
  return {
    name: 'copy-panel-json',
    closeBundle() {
      const from = resolve(repoRoot, 'panel/panel.json')
      if (existsSync(from)) cpSync(from, resolve(outDir, 'panel.json'))
    },
  }
}

export default defineConfig({
  root: entryRoot,
  // Relative asset paths: Deska serves the package from its own origin.
  base: './',
  // One cache for the whole repository, not one inside the page's folder.
  cacheDir: resolve(repoRoot, 'node_modules/.vite'),
  plugins: [copyPanelJson()],
  build: {
    outDir,
    // The folder lives outside Vite's root, so say so on purpose.
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'happy-dom',
    dir: repoRoot,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
