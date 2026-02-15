// frontend/vite.config.mts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  build: {
      sourcemap: true,
    },

    // ✅ これが本命（ngrok host許可）
    allowedHosts: ["eeliest-lorena-tartly.ngrok-free.dev"],
    // もしくは開発中は緩く
    // allowedHosts: "all",

    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://127.0.0.1:4000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
