import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Forward browser API requests to Express during local development.
// Without this proxy, Vite serves index.html for /api/* and the frontend
// fails when it tries to parse that HTML response as JSON.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
