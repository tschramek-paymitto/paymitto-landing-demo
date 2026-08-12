# PayMitto Global Transfer — landing page concepts

Two demonstration landing pages showcasing the **PayMitto** global money-transfer
feature, built on the PayMitto design system. They're framed as realistic
financial institutions offering the feature behind their own brand — mirroring
how a real client would ship it, so the pages double as inspiration for
prospective and current clients.

| Concept | Institution | Feature | Personality |
|---|---|---|---|
| **A** | Riverstone Credit Union (`/`) | "Mitto" | Warm, community, Sunrise-forward, photographic full-bleed hero |
| **B** | Keystone Bank (`/keystone/`) | "GlobalSend" | Premium, structured, Meridian-leaning, split dark hero |

Both are *Powered by PayMitto* and share one design system, one component set,
and one interactive rate calculator — only the brand, copy, and theme layer differ.
A floating switcher (bottom-right) flips between them.

> ⚠️ **Demonstration only.** Riverstone Credit Union and Keystone Bank are
> fictional institutions created by PayMitto to illustrate landing-page best
> practices. All rates, fees, figures, names, phone numbers, and routing details
> shown are illustrative and not real.

## Best-practice elements
- Interactive **"You send → they receive"** rate preview (amount, destination, delivery method)
- Real, diverse human photography (warm, candid — per PayMitto's photography direction)
- Clear three-step "How it works" and benefit pillars
- Story-driven "moments that matter" section + member testimonials (social proof)
- Flexible delivery options (bank deposit / debit card / cash pickup) with timing
- Supported-countries grid, security section, and a deep FAQ
- Promo ribbon and a compliant footer (FDIC / NCUA, partner-bank and "Powered by PayMitto" disclosures)
- Fully responsive; PayMitto palette (Sunrise / Meridian) and type (Pathway Extreme + Karla)

## Live exchange rates
The rate calculator pulls **real-time FX from the PayMitto quote API** through a
thin serverless layer, so it shows true rates and only the corridors this client
is actually enabled for.

- `GET /api/corridors` — the destinations the client supports (drives the dropdown
  and each corridor's delivery methods). The widget never offers an unsupported corridor.
- `GET /api/quote` — a real-time quote (rate, receive amount, delivery SLA) for the
  selected corridor + amount.

The OAuth `client_credentials` live **only** in server-side env vars
(`READYREMIT_CLIENT_ID` / `READYREMIT_CLIENT_SECRET`) — never in the browser. See
[`.env.example`](.env.example). If the API is unreachable (no creds, or a plain
static preview with no function runtime) the calculator **silently falls back** to
an illustrative rate table, so the page always renders.

Per the developer guide the quote token can read PII / create transfers, so it
**must** stay server-side — the server-proxy pattern here is the mandated one. A
client-credentials token is sufficient for `GET /quote`: no nonce (nonce is
transfer-only) and no sender (senderId is response-only) are required. Because the
two `/api/*` endpoints are public and front that token, they are **rate-limited per
IP** (60 quotes/min, 30 corridors/min → `429` with `Retry-After`) and **cached**
(corridors 5 min, quotes 30 s) to prevent rate-scraping — see
[`netlify/functions/_util.mjs`](netlify/functions/_util.mjs). The disclosure line
under the calculator reads "Live indicative rate…" when quotes are live and
"Illustrative rates…" in fallback, so a demo number is never shown as a live rate.

### Transfer fee & promotions
The **real** fee always comes from the quote (`/api/quote` returns it as `fee`). A
promotion is layered on top, never faked: the live fee is shown struck through with
the promo price beside it. The overlay is one declarative config — `PROMO` in
[`app.js`](app.js), overridable per page via `window.PAYMITTO_PROMO`:

| Field | Meaning |
|---|---|
| `active` | master on/off switch |
| `endsOn` | ISO date; the promo auto-expires after it (viewer's clock) |
| `price` | what the customer pays during the promo (`0` = fee waived — the common case) |
| `applies(ctx)` | optional predicate to scope it (e.g. an amount-band promo for a corridor) |
| `standardFee` | struck-through fee used only in the illustrative fallback |

So a running $0 promo renders `~~$4.50~~ $0.00` off the live rate; end it (or let
`endsOn` pass) and the same line shows the live `$4.50` on its own — no code change.

## Run locally
Plain static preview (falls back to illustrative rates — no functions):

```bash
python3 -m http.server 4317
# Concept A: http://localhost:4317/
# Concept B: http://localhost:4317/keystone/
```

With live quotes (runs the serverless functions + reads `.env`):

```bash
cp .env.example .env   # then fill in your sandbox credentials
npx netlify dev        # serves the site + /api/* on one origin
```

## Structure
```
index.html              Concept A — Riverstone Credit Union (Mitto)
styles.css              Shared PayMitto design system + layout
app.js                  Shared logic: live rate calculator, nav, FAQ, scroll reveal
keystone/
  index.html            Concept B — Keystone Bank (GlobalSend)
  keystone-theme.css    Concept B theme layer (premium / Meridian / squared)
netlify/functions/
  _readyremit.mjs       Server-side OAuth + quote-API helper (holds the secret)
  corridors.mjs         GET /api/corridors — client's supported destinations
  quote.mjs             GET /api/quote — real-time FX quote
assets/
  paymitto_symbol*.png  PayMitto brand marks
  photos/               Human photography (see credits)
```

## Photography credits
Photos are from [Pexels](https://www.pexels.com/) under the free Pexels License
(free for commercial use, no attribution required). They are self-hosted in
`assets/photos/` for reliability. Swap them for licensed brand photography before
any production use.

---
Built by PayMitto to illustrate landing-page best practices for the global transfer feature.
