/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { BackgroundSyncPlugin } from "workbox-background-sync";

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

const TILE_HOSTS = ["tiles.openfreemap.org"];
registerRoute(
  ({ url }) => TILE_HOSTS.includes(url.hostname),
  new CacheFirst({
    cacheName: "cairn-tiles",
    plugins: [],
  }),
);

const mapBgSync = new BackgroundSyncPlugin("cairn-map-sync", {
  maxRetentionTime: 60 * 24,
});

registerRoute(
  ({ url, request }) =>
    (url.pathname === "/map" || url.pathname.startsWith("/admin/users") || url.pathname.startsWith("/media/")) &&
    (request.method === "GET"),
  new NetworkFirst({
    cacheName: "cairn-api",
    networkTimeoutSeconds: 4,
  }),
);

registerRoute(
  ({ url, request }) => url.pathname === "/map" && request.method === "PUT",
  new NetworkFirst({
    cacheName: "cairn-api-writes",
    plugins: [mapBgSync],
  }),
  "PUT",
);
