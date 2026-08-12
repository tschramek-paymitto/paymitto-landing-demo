/* ==========================================================================
   GET /api/corridors

   Returns the destination countries THIS client is actually enabled for,
   grouped by country with their supported transfer methods and destination
   currency. The widget's dropdown is built from this list, so it can never
   offer a corridor the client doesn't support.

   Public endpoint fronting a token-bearing proxy, so it is rate-limited per
   IP and the (rarely-changing) result is cached briefly. Falls back to 503
   (→ browser uses illustrative demo list) when creds are absent.
   ========================================================================== */
import { hasCredentials, readyremitGet, json } from "./_readyremit.mjs";
import { clientIp, rateLimit, TTLCache } from "./_util.mjs";

const SRC_CURRENCY = process.env.READYREMIT_SRC_CURRENCY || "USD";

const cache = new TTLCache();
const CACHE_TTL = 5 * 60 * 1000; // corridors change rarely
const RL_LIMIT = 30, RL_WINDOW = 60 * 1000;

export default async (req) => {
  const rl = rateLimit(`corridors:${clientIp(req)}`, RL_LIMIT, RL_WINDOW);
  if (!rl.ok) return json(429, { error: "rate_limited" }, { "retry-after": String(rl.retryAfter) });

  if (!hasCredentials()) return json(503, { error: "not_configured" });

  const cacheKey = `corridors:${SRC_CURRENCY}`;
  const cached = cache.get(cacheKey);
  if (cached) return json(200, cached, { "x-cache": "HIT", "cache-control": "public, max-age=300" });

  try {
    const { ok, status, body } = await readyremitGet("/corridors", {
      srcCurrencyIso3Code: SRC_CURRENCY
    });
    if (!ok) return json(status === 200 ? 502 : status, { error: "upstream", status });

    const rows = Array.isArray(body) ? body : (Array.isArray(body?.corridors) ? body.corridors : []);
    const byCountry = new Map();

    for (const c of rows) {
      const country  = c.destinationCountry || {};
      const currency = c.destinationCurrency || {};
      const iso3 = country.iso3Code;
      if (!iso3) continue;

      let entry = byCountry.get(iso3);
      if (!entry) {
        entry = {
          name:          country.name || iso3,
          countryIso3:   iso3,
          currencyIso3:  currency.iso3Code || null,
          currencySymbol:currency.symbol || null,
          decimalPlaces: currency.decimalPlaces ?? 2,
          methods:       []
        };
        byCountry.set(iso3, entry);
      }
      if (c.transferMethod && !entry.methods.includes(c.transferMethod)) {
        entry.methods.push(c.transferMethod);
      }
    }

    const corridors = [...byCountry.values()]
      .filter((e) => e.currencyIso3 && e.methods.length)
      .sort((a, b) => a.name.localeCompare(b.name));

    const payload = { srcCurrency: SRC_CURRENCY, corridors };
    cache.set(cacheKey, payload, CACHE_TTL);
    return json(200, payload, { "x-cache": "MISS", "cache-control": "public, max-age=300" });
  } catch (e) {
    return json(502, { error: "exception", message: String(e?.message || e) });
  }
};
