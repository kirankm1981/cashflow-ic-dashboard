import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const isReplit = !!process.env.REPL_ID;

const replitPlugins: any[] = [];
if (isReplit) {
  try {
    const runtimeErrorOverlay = await import("@replit/vite-plugin-runtime-error-modal");
    replitPlugins.push(runtimeErrorOverlay.default());
  } catch {}

  if (process.env.NODE_ENV !== "production") {
    try {
      const cartographer = await import("@replit/vite-plugin-cartographer");
      replitPlugins.push(cartographer.cartographer());
    } catch {}
    try {
      const devBanner = await import("@replit/vite-plugin-dev-banner");
      replitPlugins.push(devBanner.devBanner());
    } catch {}
  }
}

export default defineConfig({
  plugins: [
    react(),
    ...replitPlugins,
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
