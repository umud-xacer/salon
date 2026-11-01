import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    // Dev'da CORS kerak emas: brauzer uchun API shu manzilda
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:8001" },
  },
  // Boshqa qurilmadan sinash uchun: yig'ilgan panel + API proksi (`npm run build && npm run preview`)
  preview: {
    port: 4174,
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:8001" },
  },
});
