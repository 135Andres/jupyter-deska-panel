import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.mjs', '**/*.js', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
)
