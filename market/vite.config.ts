import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Prod'da Caddy chronix.uz/api ni API'ga uzatadi (CORS kerak emas). Dev'da ham shunday proksi.
const target = process.env.VITE_API_PROXY ?? "http://127.0.0.1:8011";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5180, proxy: { "/api": { target, changeOrigin: true } } },
  preview: { port: 4180, proxy: { "/api": { target, changeOrigin: true } } },
});
