import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  css: {
    postcss: {}
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
})
