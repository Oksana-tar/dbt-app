// Работа без интернета.
// Файлы приложения хранятся в кэше; при выходе новой версии поднимите VERSION.
// data.js (расписание, переносы, тексты) всегда сначала берётся из сети, а без сети — из кэша,
// поэтому правка data.js доходит до участников при следующем открытии и без смены VERSION.
const VERSION = "v4";
const CACHE = "dbt-" + VERSION;
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "db.js",
  "data.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "fonts/onest-cyrillic.woff2",
  "fonts/onest-latin.woff2",
  "fonts/unbounded-cyrillic.woff2",
  "fonts/unbounded-latin.woff2",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("dbt-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromNetwork(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(req, { cache: "no-store" }).then(r => { clearTimeout(t); r.ok ? resolve(r) : reject(new Error(r.status)); }, err => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Файл данных: сеть (до 4 секунд), иначе кэш
  if (url.pathname.endsWith("/data.js")) {
    e.respondWith(
      fromNetwork(req, 4000)
        .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put("data.js", copy)); return r; })
        .catch(() => caches.match("data.js", { ignoreSearch: true }))
    );
    return;
  }

  // Открытие страницы: всегда index.html из кэша
  if (req.mode === "navigate") {
    e.respondWith(caches.match("index.html").then(r => r || fetch(req)));
    return;
  }

  // Остальное: кэш, иначе сеть
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
