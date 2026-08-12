/* ==========================================================================
   GET /api/quote

   Proxies a single real-time quote. The browser passes the corridor + amount;
   this returns a slim, display-ready payload (major-unit amounts + the rate).

   Amounts on the wire are MINOR units: sendAmount.value 1500 with a 2-dp
   currency is $15.00. The browser sends `amount` already in minor units and we
   convert the response back to major units here so the client stays simple.

   Public endpoint fronting a token-bearing proxy: rate-limited per IP and
   briefly cached per exact corridor+amount to blunt rate-scraping. The cache
   TTL is short because quotes are time-sensitive.
   ========================================================================== */
import { hasCredentials, readyremitGet, json } from "./_readyremit.mjs";
import { clientIp, rateLimit, TTLCache } from "./_util.mjs";

const SRC_CURRENCY = process.env.READYREMIT_SRC_CURRENCY || "USD";

const cache = new TTLCache();
const CACHE_TTL = 30 * 1000; // quotes are time-sensitive — keep short
const RL_LIMIT = 60, RL_WINDOW = 60 * 1000;

const toMajor = (money) => {
  if (!money || money.value == null) return null;
  const dp = money.currency?.decimalPlaces ?? 2;
  return money.value / Math.pow(10, dp);
};

export default async (req) => {
  const rl = rateLimit(`quote:${clientIp(req)}`, RL_LIMIT, RL_WINDOW);
  if (!rl.ok) return json(429, { error: "rate_limited" }, { "retry-after": String(rl.retryAfter) });

  if (!hasCredentials()) return json(503, { error: "not_configured" });

  const p = new URL(req.url).searchParams;
  const params = {
    srcCurrencyIso3Code: p.get("srcCurrencyIso3Code") || SRC_CURRENCY,
    dstCountryIso3Code:  p.get("dstCountryIso3Code"),
    dstCurrencyIso3Code: p.get("dstCurrencyIso3Code"),
    transferMethod:      p.get("transferMethod"),
    quoteBy:             p.get("quoteBy") || "SEND_AMOUNT",
    amount:              p.get("amount")
  };

  if (!params.dstCountryIso3Code || !params.dstCurrencyIso3Code ||
      !params.transferMethod || !params.amount) {
    return json(400, { error: "missing_params" });
  }

  const cacheKey = "quote:" + [
    params.srcCurrencyIso3Code, params.dstCountryIso3Code, params.dstCurrencyIso3Code,
    params.transferMethod, params.quoteBy, params.amount
  ].join("|");
  const cached = cache.get(cacheKey);
  if (cached) return json(200, cached, { "x-cache": "HIT" });

  try {
    const { ok, status, body } = await readyremitGet("/quote", params);
    if (!ok) return json(status, { error: "upstream", status, body });

    const feeAdj = Array.isArray(body?.adjustments)
      ? body.adjustments.find((a) => /fee/i.test(a.type || a.name || ""))
      : null;

    const payload = {
      rate:           body.rate,
      sendAmount:     toMajor(body.sendAmount),
      sendCurrency:   body.sendAmount?.currency?.iso3Code || params.srcCurrencyIso3Code,
      receiveAmount:  toMajor(body.receiveAmount),
      receiveCurrency:body.receiveAmount?.currency?.iso3Code || params.dstCurrencyIso3Code,
      receiveSymbol:  body.receiveAmount?.currency?.symbol || null,
      receiveDecimals:body.receiveAmount?.currency?.decimalPlaces ?? 2,
      totalCost:      toMajor(body.totalCost),
      fee:            feeAdj ? toMajor(feeAdj) : null,
      transferMethod: body.transferMethod || params.transferMethod,
      deliverySLA:    body.deliverySLA || null,
      quoteHistoryId: body.quoteHistoryId || null
    };

    cache.set(cacheKey, payload, CACHE_TTL);
    return json(200, payload, { "x-cache": "MISS" });
  } catch (e) {
    return json(502, { error: "exception", message: String(e?.message || e) });
  }
};
