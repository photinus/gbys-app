/* GBYS service worker (hand-written; no build step).
 *
 * Scope is deliberately tiny because the emergency sheet contains children's
 * medical data:
 *   - Navigations to /programs/<slug>/seasons/<id>/emergency are network-first.
 *     Only 200, non-redirected HTML responses are stored in EMERGENCY_CACHE.
 *     Offline, the cached copy is served. Entries expire after 14 days.
 *   - /media/athlete/<id> photos requested BY an emergency sheet page are
 *     network-first into the same EMERGENCY_CACHE (same expiry and purge).
 *   - /_next/static/* (immutable, hashed, no user data) is cache-first.
 *   - EVERYTHING ELSE (other HTML, API, auth, RSC payloads) is left alone: the
 *     fetch handler does not call respondWith, so the browser handles it.
 *   - A clear message (sent by sign-out) deletes the emergency cache.
 * Keep these constants in sync with src/lib/pwa.ts.
 */
const EMERGENCY_CACHE = "gbys-emergency-v1";
const STATIC_CACHE = "gbys-static-v1";
const SW_CLEAR_MESSAGE = "GBYS_CLEAR_SENSITIVE_CACHES";
const CACHED_AT_HEADER = "x-gbys-cached-at";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const EMERGENCY_PATH = /^\/programs\/[a-z0-9-]+\/seasons\/[0-9a-f-]{36}\/emergency\/?$/i;
// Athlete photos are cached ONLY when requested by an emergency sheet page (same
// cache, same 14-day expiry, purged on sign-out) so coaches can identify kids offline.
const ATHLETE_PHOTO_PATH = /^\/media\/athlete\/[0-9a-f-]{36}\/?$/i;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([EMERGENCY_CACHE, STATIC_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith("gbys-") && !keep.has(name)) await caches.delete(name);
      }
      await purgeExpired();
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === SW_CLEAR_MESSAGE) {
    event.waitUntil(caches.delete(EMERGENCY_CACHE));
  }
});

function cacheKey(url) {
  // Query strings never matter and must not fragment (or leak into) the cache.
  return new Request(url.origin + url.pathname.replace(/\/$/, ""));
}

function isFresh(response) {
  const at = Number(response.headers.get(CACHED_AT_HEADER));
  return Number.isFinite(at) && at > 0 && Date.now() - at < MAX_AGE_MS;
}

async function purgeExpired() {
  const cache = await caches.open(EMERGENCY_CACHE);
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (!res || !isFresh(res)) await cache.delete(req);
  }
}

async function storeEmergency(key, response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  const body = await response.clone().blob();
  const cache = await caches.open(EMERGENCY_CACHE);
  await cache.put(
    key,
    new Response(body, { status: 200, statusText: "OK", headers })
  );
}

async function handleEmergency(request, url) {
  const key = cacheKey(url);
  try {
    const response = await fetch(request);
    const isHtml = (response.headers.get("content-type") || "").includes("text/html");
    if (response.status === 200 && !response.redirected && response.type === "basic" && isHtml) {
      await storeEmergency(key, response);
    } else {
      // Access revoked, signed out, season gone, ...: do not keep a stale copy.
      const cache = await caches.open(EMERGENCY_CACHE);
      await cache.delete(key);
    }
    return response;
  } catch (err) {
    const cache = await caches.open(EMERGENCY_CACHE);
    const cached = await cache.match(key);
    if (cached && isFresh(cached)) return cached;
    if (cached) await cache.delete(key);
    throw err;
  }
}

function fromEmergencySheet(request) {
  try {
    const ref = new URL(request.referrer);
    return ref.origin === self.location.origin && EMERGENCY_PATH.test(ref.pathname);
  } catch {
    return false;
  }
}

async function handleEmergencyPhoto(request, url) {
  const key = cacheKey(url); // path only: a newer ?v= replaces the entry on the next online fetch
  try {
    const response = await fetch(request);
    const isImage = (response.headers.get("content-type") || "").startsWith("image/");
    const cache = await caches.open(EMERGENCY_CACHE);
    if (response.status === 200 && !response.redirected && response.type === "basic" && isImage) {
      await storeEmergency(key, response);
    } else {
      await cache.delete(key); // access revoked / photo removed: drop the copy
    }
    return response;
  } catch (err) {
    const cache = await caches.open(EMERGENCY_CACHE);
    const cached = await cache.match(key);
    if (cached && isFresh(cached)) return cached;
    if (cached) await cache.delete(key);
    throw err;
  }
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.status === 200 && response.type === "basic") {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStatic(request));
    return;
  }

  // Full-document navigations, or the page's own explicit "save for offline"
  // fetch (client-side navigations never issue a document request).
  const isDocument =
    request.mode === "navigate" || request.headers.get("x-gbys-offline-save") === "1";
  if (isDocument && EMERGENCY_PATH.test(url.pathname)) {
    event.respondWith(handleEmergency(request, url));
    return;
  }
  if (ATHLETE_PHOTO_PATH.test(url.pathname) && fromEmergencySheet(request)) {
    event.respondWith(handleEmergencyPhoto(request, url));
    return;
  }
  // Anything else: no respondWith, so it goes straight to the network untouched.
});
