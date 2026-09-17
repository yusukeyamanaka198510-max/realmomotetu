import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// This project lives nested inside another app's repo (see AGENTS.md /
// CLAUDE.md at the repo root) which has its own postcss.config.mjs for
// Tailwind. Vite's config resolution walks up the directory tree looking
// for a postcss config regardless of whether a given build actually uses
// CSS, and would otherwise pick up that unrelated config and fail because
// its plugin isn't installed here. Pinning `css.postcss` to an inline
// empty config for every target stops that upward search.
const isolatedCss = { postcss: {} }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    css: isolatedCss,
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    css: isolatedCss,
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()],
    css: isolatedCss,
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
