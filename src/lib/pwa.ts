// Client-safe constants shared by the service worker registration, the
// emergency sheet and sign-out (which must purge cached medical data).
export const EMERGENCY_CACHE = "gbys-emergency-v1";
export const SW_CLEAR_MESSAGE = "GBYS_CLEAR_SENSITIVE_CACHES";

/** Best-effort purge of cached emergency sheets. Safe to call anywhere client-side. */
export async function clearSensitiveCaches(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: SW_CLEAR_MESSAGE });
    if (typeof caches !== "undefined") await caches.delete(EMERGENCY_CACHE);
  } catch {
    // ignore: no SW / Cache API (private mode, old browser)
  }
}
