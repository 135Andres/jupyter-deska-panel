import { defineConfig } from '@playwright/test'

// The sanitizer runs DOMPurify, which is only trustworthy against a real DOM:
// happy-dom's node iterator skips nodes while DOMPurify removes them, so the
// sanitize tests run here, in Chromium, against the Vite dev server.
export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:5191',
  },
  webServer: {
    command: 'npx vite --port 5191 --strictPort',
    url: 'http://localhost:5191',
    reuseExistingServer: false,
  },
})
