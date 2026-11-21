import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const publicOrigin = process.env.EMS_PUBLIC_ORIGIN
  ? new URL(process.env.EMS_PUBLIC_ORIGIN)
  : undefined;
if (
  publicOrigin &&
  (publicOrigin.protocol !== "https:" ||
    publicOrigin.username ||
    publicOrigin.password)
) {
  throw new Error(
    "EMS_PUBLIC_ORIGIN must be a public HTTPS origin without credentials.",
  );
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "ems-social-preview",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          const path = "/images/E%20M%20S.png";
          const imageUrl = publicOrigin
            ? new URL(path, publicOrigin).href
            : path;
          // Vite may decode spaces while resolving public assets in meta tags.
          const updated = html.replaceAll(
            /content="\/images\/E(?: |%20)M(?: |%20)S\.png"/g,
            `content="${imageUrl}"`,
          );
          if (!publicOrigin) return updated;
          return {
            html: updated,
            tags: [
              {
                tag: "meta",
                attrs: { property: "og:url", content: publicOrigin.origin },
                injectTo: "head",
              },
            ],
          };
        },
      },
    },
  ],
  server: {
    proxy: {
      "/api": {
        target:
          mode === "worker" ? "http://127.0.0.1:8787" : "http://127.0.0.1:3000",
        changeOrigin: mode !== "worker",
      },
    },
  },
}));
