#!/usr/bin/env node
/* ==========================================================================
   Provision a client's B2C "marketing / quote" Sender.

   Each client (FI) that embeds the rate widget needs ONE dedicated business
   Sender whose sender-scoped token powers anonymous rate previews (GET /quote
   requires a Sender). This creates that Sender via POST /senders and prints the
   ID to configure as READYREMIT_SENDER_ID (or per-client config on the backend).

   Business senders are created with kycStatus SKIPPED — no KYC/KYB needed, since
   this Sender only ever quotes, never transfers.

   Reads client credentials from .env (or the shell env). NEVER prints secrets.

     node scripts/provision-sender.mjs --company "Keystone Bank" [--email ..] [--phone ..]
       [--naics 522110] [--tin 123456789] [--line1 ..] [--city ..] [--state GA] [--zip ..]
       [--no-verify]
   ========================================================================== */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const txt = readFileSync(join(root, ".env"), "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* rely on shell env */ }

// --- tiny --flag parser ---
const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const key = argv[i].slice(2);
    if (key === "no-verify") { flags.noVerify = true; continue; }
    flags[key] = argv[i + 1]; i++;
  }
}

const API_BASE      = process.env.READYREMIT_API_BASE      || "https://sandbox-api.readyremit.com/v1";
const AUDIENCE      = process.env.READYREMIT_AUDIENCE      || "https://sandbox-api.readyremit.com";
const CLIENT_ID     = process.env.READYREMIT_CLIENT_ID;
const CLIENT_SECRET = process.env.READYREMIT_CLIENT_SECRET;
const SRC           = process.env.READYREMIT_SRC_CURRENCY  || "USD";

const die = (m) => { console.error("✗ " + m); process.exit(1); };
if (!CLIENT_ID || !CLIENT_SECRET) die("Missing READYREMIT_CLIENT_ID / READYREMIT_CLIENT_SECRET (set them in .env).");

// Field values: flags win, else sensible house-account defaults. These describe
// the MARKETING/QUOTE sender, not a real consumer.
const company = flags.company || "PayMitto Global Transfers Demo";
const fields = [
  { id: "COMPANY_NAME", value: company },
  { id: "NAICS", value: flags.naics || "522320" },                     // financial transaction processing
  { id: "EMAIL_ADDRESS", value: flags.email || "quotes@paymittodemo.com" },
  { id: "PHONE_NUMBER", value: { number: flags.phone || "4045551234", countryIso3Code: "USA", countryPhoneCode: 1 } },
  { id: "ID_TYPE", value: "TIN" },
  { id: "ID_NUMBER", value: flags.tin || "123456789" },
  { id: "DATE_OF_COMPANY_REGISTRATION", value: flags.registered || "2015-03-10" },
  { id: "ADDRESS_LINE_1", value: flags.line1 || "123 Peachtree Street NE" },
  { id: "ADDRESS_CITY", value: flags.city || "Atlanta" },
  { id: "ADDRESS_STATE", value: flags.state || "GA" },
  { id: "ADDRESS_ZIP", value: flags.zip || "30303" },
  { id: "ADDRESS_COUNTRY", value: "USA" }
];

const mintToken = async (senderId) => {
  const r = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, audience: AUDIENCE, grant_type: "client_credentials", ...(senderId ? { sender_id: senderId } : {}) })
  });
  if (!r.ok) die(`token request failed: HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  return r.json();
};

console.log(`• environment : ${API_BASE}`);
console.log(`• company     : ${company}\n`);

// 1) Client-level token (a Sender can't exist yet to scope to).
const clientTok = await mintToken();

// 2) Create the BUSINESS sender.
const res = await fetch(`${API_BASE}/senders`, {
  method: "POST",
  headers: { authorization: `Bearer ${clientTok.access_token}`, "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ senderType: "BUSINESS", fields })
});
const txt = await res.text();
let body; try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
if (!res.ok) die(`POST /senders failed: HTTP ${res.status}\n${JSON.stringify(body, null, 2).slice(0, 1200)}`);

const senderId = body.senderId || body.id;
console.log(`✓ created BUSINESS sender`);
console.log(`  senderId : ${senderId}`);
console.log(`  company  : ${body.companyName || company}`);
console.log(`  kycStatus: ${body.kycStatus || "(n/a)"}`);

// 3) Optionally verify the new sender can quote.
if (!flags.noVerify) {
  const senderTok = await mintToken(senderId);
  const qs = new URLSearchParams({ srcCurrencyIso3Code: SRC, dstCountryIso3Code: "MEX", dstCurrencyIso3Code: "MXN", transferMethod: "CASH_PICKUP", quoteBy: "SEND_AMOUNT", amount: "50000" });
  const q = await fetch(`${API_BASE}/quote?${qs}`, { headers: { authorization: `Bearer ${senderTok.access_token}`, accept: "application/json" } });
  const qt = await q.text(); let qb; try { qb = JSON.parse(qt); } catch { qb = qt; }
  if (q.status === 200 && qb.rate) {
    const dp = qb.receiveAmount?.currency?.decimalPlaces ?? 2;
    console.log(`  quote OK : $500 ${SRC} -> Mexico ${qb.receiveAmount?.value / Math.pow(10, dp)} MXN @ ${qb.rate}`);
  } else {
    console.log(`  quote    : ⚠ HTTP ${q.status} ${JSON.stringify(qb).slice(0, 160)}`);
  }
}

console.log(`\nNext: configure this Sender for the client, e.g.\n  READYREMIT_SENDER_ID=${senderId}`);
