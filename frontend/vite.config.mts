import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    hmr: false,
    allowedHosts: "all", // ★これが決定打
    cors: true,

    proxy: {
      "/socket.io": {
        target: "http://localhost:4000",
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
