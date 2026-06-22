// Real build config -- CRXJS Vite plugin bundles manifest.json (rewriting
// the background service worker's path to the built output automatically)
// plus the React popup/tab entry point at index.html, which reuses the
// existing React UI components from frontend/src/components/surge/ and the
// ported rules engine/agent from frontend/src/lib/surge/engine/ directly --
// no copies of either live under this folder. VITE_SURGE_MODE=local makes
// client.ts (the same swap-point already used for the web app's mock/real
// backend toggle) route every call to the in-browser TypeScript engine
// instead of fetch() calls to a backend, since there is no backend here.
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../frontend/src"),
      // Files under frontend/src resolve bare "react"/"react-dom" imports
      // by walking up from their own location to frontend/node_modules,
      // while this folder's own entry (src/main.tsx) resolves the same
      // bare imports to extension/node_modules -- two separate React
      // instances in the same bundle, which breaks hooks ("Cannot read
      // properties of null (reading 'useState')") since the dispatcher
      // isn't shared. Force both import sites to the one copy.
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
  },
  define: {
    "import.meta.env.VITE_SURGE_MODE": JSON.stringify("local"),
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "index.html"),
      },
    },
  },
});
