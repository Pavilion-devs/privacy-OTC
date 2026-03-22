import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: "buffer/",
    },
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["buffer/"],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          web3: [
            "@solana/web3.js",
            "buffer/",
          ],
          wallet: [
            "@solana/wallet-adapter-base",
            "@solana/wallet-adapter-phantom",
            "@solana/wallet-adapter-react",
            "@solana/wallet-adapter-react-ui",
            "@solana/wallet-adapter-solflare",
          ],
          gum: ["@magicblock-labs/gum-react-sdk"],
          per: ["@magicblock-labs/ephemeral-rollups-sdk"],
        },
      },
    },
  },
});
