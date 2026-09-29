#!/usr/bin/env node
/* ==========================================================================
   OAuth + quote-API smoke test.

   Proves the flow end to end: token → /corridors → a live /quote. Reads
   credentials from .env (or the shell env). NEVER prints the client_secret or
   the full access token.

   Live quotes need a Sender: GET /quote returns SenderUndetermined for a plain
   client-level token, so when READYREMIT_SENDER_ID is set we mint a
   SENDER-SCOPED token (sender_id in the token request) and quote with that.

     node scripts/verify-oauth.mjs        # or: npm run verify:oauth
   ========================================================================== */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader (KEY=VALUE, # comments). A real shell env wins over .env.
try {
  const txt = readFileSync(join(root, ".env"), "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch { /* no .env — fall back to the shell env */ }

const API_BASE      = process.env.READYREMIT_API_BASE      || "https://sandbox-api.readyremit.com/v1";
const AUDIENCE      = process.env.READYREMIT_AUDIENCE      || "https://sandbox-api.readyremit.com";
const CLIENT_ID     = process.env.READYREMIT_CLIENT_ID;
const CLIENT_SECRET = process.env.READYREMIT_CLIENT_SECRET;
const SENDER_ID     = process.env.READYREMIT_SENDER_ID;
const SRC           = process.env.READYREMIT_SRC_CURRENCY  || "USD";

const die = (msg) => { console.error("✗ " + msg); process.exit(1); };

if (!CLIENT_ID || !CLIENT_SECRET) {
  die("Missing credentials. Copy .env.example to .env and set " +
      "READYREMIT_CLIENT_ID / READYREMIT_CLIENT_SECRET (or export them in your shell).");
}

console.log(`• API base : ${API_BASE}`);
console.log(`• audience : ${AUDIENCE}`);
console.log(`• client_id: ${CLIENT_ID.slice(0, 4)}…${CLIENT_ID.slice(-2)} (${CLIENT_ID.length} chars)`);
console.log(`• token    : ${SENDER_ID ? "SENDER-SCOPED (sender_id set)" : "client-level (no sender_id)"}\n`);

// 1) Token ------------------------------------------------------------------
const tokRes = await fetch(`${API_BASE}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    audience: AUDIENCE,
    grant_type: "client_credentials",
    ...(SENDER_ID ? { sender_id: SENDER_ID } : {})
  })
}).catch((e) => die(`Network error reaching ${API_BASE}: ${e.message}`));

if (!tokRes.ok) {
  const detail = await tokRes.text().catch(() => "");
  die(`Token request failed: HTTP ${tokRes.status}. ${detail.slice(0, 300)}\n` +
      "  → Check client_id/secret (and sender_id if set) are for THIS environment.");
}
const tok = await tokRes.json();
if (!tok.access_token) die("Token response had no access_token: " + JSON.stringify(tok).slice(0, 200));
console.log(`✓ OAuth token acquired — type ${tok.token_type}, expires in ${tok.expires_in}s ` +
            `(token length ${tok.access_token.length})`);

const authGet = async (path, params) => {
  const url = new URL(`${API_BASE}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok.access_token}`, accept: "application/json" } });
  const txt = await r.text();
  let body; try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  return { ok: r.ok, status: r.status, body };
};

// sourceCurrency / destinationCurrency come back as ARRAYS from the live API.
const firstCcy = (v) => (Array.isArray(v) ? v[0] : v) || {};

// 2) Corridors --------------------------------------------------------------
const cor = await authGet("/corridors", { srcCurrencyIso3Code: SRC });
if (!cor.ok) die(`/corridors failed: HTTP ${cor.status} ${JSON.stringify(cor.body).slice(0, 200)}`);
const rows = Array.isArray(cor.body) ? cor.body : [];
const countries = [...new Set(rows.map((c) => c.destinationCountry?.iso3Code).filter(Boolean))];
console.log(`✓ /corridors — ${rows.length} corridor rows across ${countries.length} ` +
            `countries (e.g. ${countries.slice(0, 6).join(", ") || "none"})`);

// 3) One live quote ---------------------------------------------------------
// Build the list of usable corridors (populated currency), preferring mainstream
// US remittance destinations, then try each until one quotes. Some corridors
// legitimately reject $500 (amount limits) or are flaky in sandbox, so a single
// failure isn't a setup problem — we only fail if NONE quote.
const PREFERRED = ["MEX", "IND", "PHL", "COL", "NGA", "GTM", "HND", "DOM", "KEN"];
const usable = rows
  .map((c) => ({
    country: c.destinationCountry?.iso3Code,
    name:    c.destinationCountry?.name,
    ccy:     firstCcy(c.destinationCurrency).iso3Code,
    dp:      firstCcy(c.destinationCurrency).decimalPlaces ?? 2,
    method:  c.transferMethod
  }))
  .filter((c) => c.country && c.ccy && c.method);

const rankC = (iso) => { const i = PREFERRED.indexOf(iso); return i === -1 ? 99 : i; };
const rankM = { CASH_PICKUP: 0, BANK_ACCOUNT: 1, PUSH_TO_CARD: 2 };
usable.sort((a, b) => rankC(a.country) - rankC(b.country) || (rankM[a.method] ?? 9) - (rankM[b.method] ?? 9));

if (!usable.length) { console.log("⚠ No usable corridor with a destination currency found — skipping quote."); process.exit(0); }

let quoted = null;
const tried = [];
for (const pick of usable.slice(0, 12)) {
  const q = await authGet("/quote", {
    srcCurrencyIso3Code: SRC, dstCountryIso3Code: pick.country, dstCurrencyIso3Code: pick.ccy,
    transferMethod: pick.method, quoteBy: "SEND_AMOUNT", amount: 50000 // $500.00 in minor units
  });
  if (q.ok && !Array.isArray(q.body)) { quoted = { pick, b: q.body }; break; }
  const code = Array.isArray(q.body) ? q.body[0]?.code : q.body?.code;
  tried.push(`${pick.country}/${pick.method}:${code || q.status}`);
  if (/SenderUndetermined/i.test(JSON.stringify(q.body))) {
    die("/quote needs a Sender (SenderUndetermined).\n" +
        "  → Set READYREMIT_SENDER_ID in .env to a valid Sender ID (a provisioned\n" +
        "    B2C business-as-sender ID, or a Sender created via POST /senders).");
  }
}

if (!quoted) die(`No corridor produced a quote for $500. Tried: ${tried.join(", ")}`);

const { pick, b } = quoted;
const dp = b.receiveAmount?.currency?.decimalPlaces ?? pick.dp;
const rec = b.receiveAmount?.value != null ? (b.receiveAmount.value / Math.pow(10, dp)) : "?";
console.log(`✓ /quote — $500 ${SRC} → ${pick.name} via ${pick.method}: ` +
            `${rec} ${b.receiveAmount?.currency?.iso3Code || pick.ccy} @ rate ${b.rate}`);
if (tried.length) console.log(`  (skipped: ${tried.join(", ")})`);

console.log("\n✅ OAuth setup verified — the live quote layer is good to go.");
