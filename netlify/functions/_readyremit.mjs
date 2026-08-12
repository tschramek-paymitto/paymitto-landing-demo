/* ==========================================================================
   Shared PayMitto quote-API helper for the Netlify Functions layer.

   The quote API authenticates with an OAuth client_credentials secret. That
   secret is treated like a private key — it lives ONLY here, server-side, in
   environment variables, and is never shipped to the browser. The browser
   talks to /api/corridors and /api/quote; this module talks to the upstream.
   ========================================================================== */

const API_BASE   = process.env.READYREMIT_API_BASE   || "https://sandbox-api.readyremit.com/v1";
const AUDIENCE    = process.env.READYREMIT_AUDIENCE    || "https://sandbox-api.readyremit.com";
const CLIENT_ID   = process.env.READYREMIT_CLIENT_ID;
const CLIENT_SECRET = process.env.READYREMIT_CLIENT_SECRET;

/** True only when server-side credentials are configured. When false, the
 *  functions return 503 and the browser silently falls back to demo rates. */
export function hasCredentials() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

// Token is cached in module scope for the lifetime of a warm function
// container. expires_in is typically 86400s; we refresh a minute early.
let cachedToken = null; // { value: string, expiresAt: number }

async function getToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      audience: AUDIENCE,
      grant_type: "client_credentials"
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`token request failed (${res.status}) ${detail}`.trim());
  }

  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: now + (data.expires_in ? data.expires_in * 1000 : 3_600_000)
  };
  return cachedToken.value;
}

/** Authenticated GET against the quote API. Returns { ok, status, body }. */
export async function readyremitGet(path, params) {
  const token = await getToken();
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

/** JSON Response helper. Quote data is never cached at the edge. */
export function json(statusCode, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extraHeaders }
  });
}
