import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,

    // ✅ スマホからHMRが繋がるようにする
    hmr: {
      host: '192.168.1.223',
      protocol: 'ws',
      port: 5173,
    },
  },
})
