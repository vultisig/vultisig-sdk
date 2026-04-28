import react from '@vitejs/plugin-react'
import vultisig from '@vultisig/sdk/vite'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), vultisig()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor'
          }
          if (
            id.includes('@vultisig/sdk') ||
            (id.includes('node_modules/@vultisig') && !id.includes('node_modules/@vultisig/lib-'))
          ) {
            return 'sdk'
          }
        },
      },
    },
  },
  server: { port: 3000, open: true },
})
