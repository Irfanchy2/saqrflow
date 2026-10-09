import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({
  esbuild: { jsx: 'automatic' },   // same JSX runtime as Next (components render in unit tests)
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname), 'server-only': path.resolve(__dirname, 'tests/fixtures/empty.mjs') } },
})
