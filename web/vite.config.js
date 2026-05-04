import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/status": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        rewrite: () => "/status",
      },
      "/api/tasks.json": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        rewrite: () => "/tasks.json",
      },
    },
  },
});
