import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname), 'server-only': path.resolve(__dirname, 'tests/fixtures/empty.mjs') } },
})
