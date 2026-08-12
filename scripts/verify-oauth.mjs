#!/usr/bin/env node
/* ==========================================================================
   OAuth + quote-API smoke test.

   Proves the client_credentials flow end to end: token → /corridors → a live
   /quote. Reads credentials from .env (or the shell env). NEVER prints the
   client_secret or the full access token.

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
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch { /* no .env — fall back to the shell env */ }

const API_BASE      = process.env.READYREMIT_API_BASE      || "https://sandbox-api.readyremit.com/v1";
const AUDIENCE      = process.env.READYREMIT_AUDIENCE      || "https://sandbox-api.readyremit.com";
const CLIENT_ID     = process.env.READYREMIT_CLIENT_ID;
const CLIENT_SECRET = process.env.READYREMIT_CLIENT_SECRET;
const SRC           = process.env.READYREMIT_SRC_CURRENCY  || "USD";

const die = (msg) => { console.error("✗ " + msg); process.exit(1); };

if (!CLIENT_ID || !CLIENT_SECRET) {
  die("Missing credentials. Copy .env.example to .env and set " +
      "READYREMIT_CLIENT_ID / READYREMIT_CLIENT_SECRET (or export them in your shell).");
}

console.log(`• API base : ${API_BASE}`);
console.log(`• audience : ${AUDIENCE}`);
console.log(`• client_id: ${CLIENT_ID.slice(0, 4)}…${CLIENT_ID.slice(-2)} (${CLIENT_ID.length} chars)\n`);

// 1) Token ------------------------------------------------------------------
const tokRes = await fetch(`${API_BASE}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    audience: AUDIENCE,
    grant_type: "client_credentials"
  })
}).catch((e) => die(`Network error reaching ${API_BASE}: ${e.message}`));

if (!tokRes.ok) {
  const detail = await tokRes.text().catch(() => "");
  die(`Token request failed: HTTP ${tokRes.status}. ${detail.slice(0, 300)}\n` +
      "  → Check the client_id/secret and that they're for THIS environment (sandbox vs prod).");
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

// 2) Corridors --------------------------------------------------------------
const cor = await authGet("/corridors", { srcCurrencyIso3Code: SRC });
if (!cor.ok) die(`/corridors failed: HTTP ${cor.status} ${JSON.stringify(cor.body).slice(0, 200)}`);
const rows = Array.isArray(cor.body) ? cor.body : [];
const countries = [...new Set(rows.map((c) => c.destinationCountry?.iso3Code).filter(Boolean))];
console.log(`✓ /corridors — ${rows.length} corridor rows across ${countries.length} ` +
            `countries (e.g. ${countries.slice(0, 6).join(", ") || "none"})`);

// 3) One live quote ---------------------------------------------------------
const first = rows[0];
if (first) {
  const q = await authGet("/quote", {
    srcCurrencyIso3Code: SRC,
    dstCountryIso3Code:  first.destinationCountry?.iso3Code,
    dstCurrencyIso3Code: first.destinationCurrency?.iso3Code,
    transferMethod:      first.transferMethod,
    quoteBy:             "SEND_AMOUNT",
    amount:              50000 // $500.00 in minor units
  });
  if (!q.ok) die(`/quote failed: HTTP ${q.status} ${JSON.stringify(q.body).slice(0, 200)}`);
  const b = q.body;
  const dp = b.receiveAmount?.currency?.decimalPlaces ?? 2;
  const rec = b.receiveAmount?.value != null ? (b.receiveAmount.value / Math.pow(10, dp)) : "?";
  console.log(`✓ /quote — $500 ${SRC} → ${first.destinationCountry?.name} via ` +
              `${first.transferMethod}: ${rec} ${b.receiveAmount?.currency?.iso3Code} @ rate ${b.rate}`);
} else {
  console.log("⚠ No corridors returned — the client may not have any enabled yet.");
}

console.log("\n✅ OAuth setup verified — the quote layer is good to go.");
