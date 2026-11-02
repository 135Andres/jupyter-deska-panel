import { defineConfig } from '@playwright/test'

const port = process.env['E2E_PORT'] ?? '5191'
const baseURL = `http://localhost:${port}`

// The sanitizer runs DOMPurify, which is only trustworthy against a real DOM:
// happy-dom's node iterator skips nodes while DOMPurify removes them, so the
// sanitize tests run here, in Chromium, against the Vite dev server.
export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL,
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
})
