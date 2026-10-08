const CACHE_NAME = "parkview-v155";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=115",
  "./config.js?v=4",
  "./native-bridge-source.js?v=100",
  "./app.js?v=150",
  "./camera-analysis.js?v=15",
  "./camera-analysis-core.js?v=4",
  "./vendor/onnxruntime/ort.wasm.bundle.js?v=1",
  "./manifest.webmanifest",
  "./favicon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      const previousCaches = keys.filter((key) => key !== CACHE_NAME);
      await Promise.all(previousCaches.map((key) => caches.delete(key)));
      await self.clients.claim();
      if (!previousCaches.some((key) => key.startsWith("parkview-v"))) return;
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map((client) => client.navigate(client.url)));
    })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.includes("/api/")) return;
  const isModelAsset = requestUrl.origin === self.location.origin
    && (requestUrl.pathname.endsWith(".onnx") || requestUrl.pathname.endsWith(".wasm"));
  if (isModelAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
        const copy = response.clone();
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }))
    );
    return;
  }
  const isCoreAsset = requestUrl.origin === self.location.origin &&
    ["document", "script", "style"].includes(event.request.destination);
  if (isCoreAsset) {
    event.respondWith(
      fetch(event.request).then((response) => {
        const copy = response.clone();
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request).then((cached) => cached ||
        (event.request.destination === "document" ? caches.match("./index.html") : Response.error())))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).catch(() => Response.error())
    )
  );
});
