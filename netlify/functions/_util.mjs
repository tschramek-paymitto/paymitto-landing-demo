/* ==========================================================================
   Lightweight, dependency-free rate limiting + response caching for the two
   public quote endpoints.

   These are IN-MEMORY and per-container. Netlify may run several warm
   containers, so this is a pragmatic mitigation — not a global guarantee. Its
   job is to stop a single client from hammering the token-bearing proxy or
   scraping live rates in bulk. For hard global limits, back these with a
   shared store (Netlify Blobs / Redis); the call sites won't change.
   ========================================================================== */

/** Client IP for the rate-limit key — ONLY from the platform-set header.
 *  A client-supplied X-Forwarded-For is spoofable (trivial per-IP limit
 *  bypass), so we never use it as the key; absent the trusted header we fail
 *  closed into a single shared "unknown" bucket. On Azure this becomes the
 *  Front Door-injected client IP header. */
export function clientIp(req) {
  const h = req && req.headers;
  const get = (k) => (h && typeof h.get === "function" ? h.get(k) : h && h[k]);
  return get("x-nf-client-connection-ip") || "unknown";
}

// --- sliding-window rate limiter -----------------------------------------
const hits = new Map(); // key -> ascending timestamps (ms)

/** Returns { ok:true, remaining } or { ok:false, retryAfter } (seconds). */
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;

  let arr = hits.get(key);
  if (!arr) { arr = []; hits.set(key, arr); }

  // Drop timestamps that fell out of the window (arr is ascending).
  let drop = 0;
  while (drop < arr.length && arr[drop] <= cutoff) drop++;
  if (drop > 0) arr.splice(0, drop);

  if (arr.length >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) };
  }
  arr.push(now);

  // Bound memory: occasionally evict fully-expired keys.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.length || v[v.length - 1] <= cutoff) hits.delete(k);
  }
  return { ok: true, remaining: limit - arr.length };
}

// --- TTL cache ------------------------------------------------------------
export class TTLCache {
  constructor() { this.store = new Map(); }

  get(key) {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) { this.store.delete(key); return undefined; }
    return e.value;
  }

  set(key, value, ttlMs) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.store.size > 2000) {
      const now = Date.now();
      for (const [k, e] of this.store) if (e.expiresAt <= now) this.store.delete(k);
    }
  }
}
