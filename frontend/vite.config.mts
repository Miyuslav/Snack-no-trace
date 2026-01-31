import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// export default defineConfig({
//   plugins: [react()],
//   server: {
//     host: true,
//     port: 5173,
//     strictPort: true,
//     hmr: {
//       protocol: 'ws',
//       host: '192.168.1.223',
//       port: 5173,
//       clientPort: 5173,
//     },
//   },
// })


export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    hmr: false,
    proxy: {
      "/socket.io": {
        target: "http://localhost:4000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
