/// <reference types="vitest/config" />
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Build target: the plugin serves this folder under /medusify (see ../plugin/src/lib/static.ts).
export default defineConfig({
  base: "/medusify/",
  plugins: [react()],
  build: {
    outDir: "../plugin/pwa-dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    // The wasm decoder is loaded on demand from its own file, never inlined.
    assetsInlineLimit: 0,
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
})
