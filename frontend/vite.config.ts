import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      VitePWA({
        strategies: "injectManifest",
        srcDir: ".",
        filename: "sw.ts",
        registerType: "autoUpdate",
        injectRegister: "auto",
        manifest: {
          id: "/",
          name: "Cairn",
          short_name: "Cairn",
          description: "Collaborative field-reporting: map + photos + audio + video, offline-first.",
          theme_color: "#1f2937",
          background_color: "#0b1220",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        injectManifest: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        devOptions: {
          enabled: false,
          type: "module",
        },
      }),
    ],
    define: {
      __API_URL__: JSON.stringify(env.VITE_API_URL ?? ""),
    },
    server: {
      host: true,
      port: 5173,
    },
  };
});
