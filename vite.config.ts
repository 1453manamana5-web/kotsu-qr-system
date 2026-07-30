import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/kotsu-qr-system/",

  plugins: [
    react(),
  ],
});