import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({
  test: { include: ['tests/db/**/*.test.ts'], environment: 'node', testTimeout: 30000, fileParallelism: false },
  resolve: { alias: { '@': path.resolve(__dirname), 'server-only': path.resolve(__dirname, 'tests/fixtures/empty.mjs') } },
})
