const APP_CACHE = 'unified-msedcl-shell-v3'
const RUNTIME_CACHE = 'unified-msedcl-runtime-v3'
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './favicon.svg']

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(SHELL_FILES)),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const requestUrl = new URL(event.request.url)

  if (requestUrl.origin !== self.location.origin) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone()
          void caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, clone))
          return response
        })
        .catch(async () => {
          const cachedPage = await caches.match(event.request)
          if (cachedPage) {
            return cachedPage
          }
          return (await caches.match('./index.html')) || (await caches.match('./'))
        }),
    )
    return
  }

  if (requestUrl.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(async (cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse
        }
        const response = await fetch(event.request)
        const cache = await caches.open(RUNTIME_CACHE)
        cache.put(event.request, response.clone())
        return response
      }),
    )
    return
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone()
        void caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, clone))
        return response
      })
      .catch(() => caches.match(event.request)),
  )
})
