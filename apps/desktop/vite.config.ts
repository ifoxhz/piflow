import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;
const ragPort = process.env.PIFLOW_RAG_PORT ?? "3847";

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${ragPort}`,
        changeOrigin: true,
        // Chat can take 30–180s (embed + Ollama); default proxy idle can drop early.
        timeout: 300_000,
        proxyTimeout: 300_000,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
}));
