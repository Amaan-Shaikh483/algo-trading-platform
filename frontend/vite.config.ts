import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true as unknown as string[],
  },
  resolve: {
    alias: {
      // Bundle the workspace rule-schema straight from SOURCE. The package's
      // dist/ is a gitignored build artifact (rebuilt by postinstall / root
      // scripts); going through it let a stale prebuilt copy shadow new
      // exports ("does not provide an export named 'summarizeRules'").
      '@algo/rule-schema': path.resolve(__dirname, '../packages/rule-schema/src/index.ts'),
    },
  },
})
