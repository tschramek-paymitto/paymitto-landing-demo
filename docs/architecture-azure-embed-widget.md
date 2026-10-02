# PayMitto Global Transfers — Embeddable Rate Widget (Azure) Architecture

Status: **Design blueprint** (for review before build). Target: production on **Azure**, embedded via **iframe** on client (FI) landing pages.

This ports the current static demo + serverless quote proxy into a **multi-tenant, iframe-embeddable** FX rate widget with an **hourly rate cache**. It was produced by a research → synthesis → adversarial-review pass; the review's corrections are folded in.

---

## 1. Executive summary & recommended Azure shape

**One public origin — `widget.paymitto.com` — behind a single Azure Front Door** that fronts everything (widget bundle, `/embed`, `/api/*`, `/rates`, `/config`). This makes every browser fetch same-origin (no CORS) and gives exactly one CDN.

| Concern | Recommendation |
|---|---|
| **Public edge** | **Azure Front Door (Standard)** on `widget.paymitto.com` — managed TLS + WAF; the single front for all routes |
| **Static assets** (widget bundle + demo pages) | **Blob static-website** (cheapest) *or* **Static Web Apps (Standard)** (auto CI/PR previews) — behind Front Door. **Never run both CDNs.** |
| **Backend** (proxy + scheduler + `/embed`) | **Standalone Azure Functions**, Flex Consumption, Node 22 isolated |
| **Rate table + public config + logos** | **Blob Storage (GPv2, ZRS)**, edge-cached |
| **Secret-ish tenant config** | **Table Storage** (`PartitionKey={clientId}`), server-side only |
| **Secrets** (`client_secret`, per-tenant Sender IDs) | **Key Vault** via **system-assigned Managed Identity** |
| **Observability** | **Application Insights + Azure Monitor alerts** (staleness dead-man's-switch) |
| **Dropped** | ~~Azure Managed Redis~~, ~~Cosmos DB~~, ~~RA-GRS~~ — unnecessary standing cost for this workload |

**Decisive constraint:** Static Web Apps *managed* functions are HTTP-trigger-only — **no Timer trigger, no Key Vault references, no managed identity**. The hourly job and secrets therefore **must** live in a standalone Functions app.

---

## 2. The core insight that shapes everything

A marketing page is **anonymous**; the quote API is **sender-scoped** (`GET /quote` → `SenderUndetermined` without a Sender). We reconcile these by **never quoting on the visitor path**:

- **Sender-scoped tokens are minted ONLY inside the hourly Timer job**, used to quote, then discarded (a local variable — no shared token store needed).
- **Anonymous visitors read a precomputed, edge-cached, display-only rate table.** No token, no Sender ID, no `/quote` on the visitor path → `SenderUndetermined` can't occur and **rate-scraping exposes only already-public indicative rates.**

**Critical cache-model correction:** the calculator is **interactive on send amount**, and ReadyRemit's fee comes from a per-quote `adjustments` array. A single hourly snapshot at one amount **cannot** price an arbitrary typed amount. So the cache stores the **amount-independent FX rate + a fee rule** (flat/percent/min/bands) — or a small **amount ladder** (50/100/250/500/1000/2500) to interpolate — and the widget computes `receive`/`fee` **client-side**. *Whether ReadyRemit fees are linear must be validated empirically before committing the schema.*

**Cost correction — de-duplicate the sweep:** corridors + FX come from the **single Brightwell `client_id`** (`GET /corridors` is client-scoped), and per-tenant marketing senders are all B2C senders under it — so FX is the same across tenants and `enabledCorridors[]` is just a per-tenant **display subset**. The sweep quotes the **union of enabled corridors once** per (source currency, ladder point), then **fans out per-tenant** by filtering + applying each tenant's fee/promo overlay — **not** 97 × N.

---

## 3. Components

| Component | Azure service | Role |
|---|---|---|
| Public edge | Front Door Standard | Single front; routes `/rates`,`/config`→Storage, `/embed`,`/api`→Functions, else→static host; origin lockdown via Private Link |
| Widget + demo host | Blob static-website *or* SWA | Serves `widget.html`, JS/CSS, demo pages |
| Backend | Functions (Flex, Node 22) | Hourly Timer sweep, dynamic `/embed`, low-traffic reads |
| Rate cache | Blob (ZRS) | `/rates/{clientId}/{srcCcy}/{epoch}.json` (+ `manifest.json` pointer), `Cache-Control public,max-age=3600`, carries `generatedAt`+`schemaVersion` |
| Tenant registry | Table Storage | Sender secret name, `allowedEmbedDomains`, `enabledCorridors`, source currencies, CTA deep-link, fee/promo overlay |
| Secret store | Key Vault + Managed Identity | `client_secret` (as app setting via `@Microsoft.KeyVault(...)`) + per-tenant Sender IDs (runtime `SecretClient`) |
| Observability | App Insights + Monitor | Per-tenant run-success, per-corridor stale count, staleness/sweep-failure alerts |

---

## 4. Data flows

### Visitor (loads the embedded widget)
1. FI page loads `<iframe src="https://widget.paymitto.com/embed?client=riverstone&theme=auto&corridor=MEX&amount=500&src=USD&lang=en">`.
2. Front Door serves `/embed` **edge-cached by `clientId`** (CSP depends on tenant, not visitor → no Function per page view). On miss, the Function resolves tenant config and returns widget HTML with **per-tenant `Content-Security-Policy: frame-ancestors`** (who may frame it) + a widget-document CSP (`script-src 'self'`…).
3. Widget boots `app.js`, reads `client/theme/corridor/amount/src/lang` from its URL, applies branding + "Powered by PayMitto".
4. `app.js` fetches **same-origin** `/config/{clientId}.json` and `/rates/{clientId}/{srcCcy}/manifest.json → {epoch}.json` — display fields only (rate, fee rule/ladder, currency, decimals, SLA, `generatedAt`).
5. If `generatedAt` age > ~2–3× cron interval → show **"rates temporarily unavailable"**, don't label numbers "live". When fresh → compute `receive = send × rate`, `fee = applyFeeRule(send)` **client-side** (keeps the interactive calculator; `reqSeq` guard + promo overlay carry over).
6. If rates unreachable → **per-tenant** fallback limited to that tenant's `enabledCorridors` (never the legacy 13-row table), or disabled for production FI tenants.
7. Widget posts `{source:'paymitto-widget',type:'resize',height}` to the parent; **the parent-side listener** verifies `event.origin` + `event.source` before resizing. "Send money" CTA opens the tenant's authenticated-app deep-link in a new tab.

### Hourly refresh (Timer job)
1. `TimerTrigger` `'0 0 * * * *'` **UTC** (Flex/Consumption Linux ignores `WEBSITE_TIME_ZONE`).
2. Blob single-instance lock → exactly one run when scaled out.
3. Read tenant registry → compute the **union** of (corridor, method, source currency) across tenants.
4. Fetch marketing Sender ID from Key Vault → mint **one sender-scoped token** (local variable).
5. Quote the union at the amount-ladder points → extract amount-independent rate + fee rule/ladder; normalize `destination/sourceCurrency` **arrays** + minor→major.
5a. For each quote, also `GET /v1/quote/{quoteHistoryId}/promotion` (**404** = no promo). When present, capture `feeDiscountAmount` → store the **pre-discount "original" fee** (net + discount), the discounted fee, the promo name, and `adjustedFxRateUndiscounted`. This is what lets the widget render the real struck-through "~~$2.99~~ **$0.00**" from live data instead of a config.
6. **Fan out per-tenant:** filter to `enabledCorridors`, apply fee/promo overlay → write versioned blob + flip `manifest.json`.
7. Per-corridor error → keep last-good + mark stale; whole-tenant failure → keep prior table + **alert** (never write an empty table). Emit metrics.
8. **Bootstrap sweep at tenant onboarding** so the first load is never a cold miss.

---

## 5. Iframe embed contract

```html
<iframe
  src="https://widget.paymitto.com/embed?client=riverstone&theme=auto&corridor=MEX&amount=500&src=USD&lang=en"
  title="PayMitto Global Transfers rate calculator"
  width="100%" height="520"
  style="border:0;width:100%;max-width:480px;min-height:480px"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>

<!-- Optional auto-height listener (or use the CSP-clean embed.js loader) -->
<script>
(function(){
  var ORIGIN='https://widget.paymitto.com';
  var f=document.currentScript.previousElementSibling;
  window.addEventListener('message',function(e){
    if(e.origin!==ORIGIN) return;                 // the REAL gate — parent-side
    if(!f||e.source!==f.contentWindow) return;
    var d=e.data;
    if(!d||d.source!=='paymitto-widget'||d.type!=='resize') return;
    if(typeof d.height==='number') f.style.height=d.height+'px';
  });
})();
</script>
```

**Params (all public display config — never secrets):** `client` (required, opaque tenant handle), `theme`, `corridor`, `amount`, `src` (selects the tenant's cached source-currency table — **not** cosmetic), `lang`.

- **Sizing:** cross-origin frame can't self-measure the parent; widget posts height, parent listener applies it. Fixed height is the no-JS fallback. Recommended box `max-width:480px; min-height:480px`.
- **Sandbox:** `allow-scripts` + `allow-same-origin` combined **on purpose** (safe because the widget is cross-origin to the FI); `allow-top-navigation` **omitted** so it can't hijack the FI's top window; CTA uses `target=_blank` + `allow-popups`.
- **Theming:** per-tenant **colors, typography (font family + size), and logo** from public `/config/{clientId}.json` + logos/fonts **we host**, **validated at write time**, applied as CSS custom properties on `:root` (never as raw injected CSS); widget-document CSP blocks injected markup/script. See §5a.

---

## 5a. Branding configuration (per customer)

Each customer (FI) configures the widget to match their landing page. Branding is **config-driven** (not arbitrary CSS, and not inherited from the parent page — an iframe can't inherit the host's fonts across origins). Values are **validated/sanitized at write time** and surfaced to the widget as **CSS custom properties**, so a malformed or malicious value can never inject markup, script, or break out of a property.

### What's configurable
| Token | Example | Validation |
|---|---|---|
| `colors.primary` / `onPrimary` / `accent` / `surface` / `text` / `muted` / `border` | `#0B5FFF` | Strict CSS color grammar only (hex / `rgb()` / `hsl()` / named). Reject anything containing `url(`, `;`, `}`, `/*`, `expression`, whitespace tricks. |
| `typography.fontFamily` | `"inter"` (key) **or** `"Inter, system-ui, sans-serif"` (stack) | **Allowlist of curated web fonts we self-host** (recommended): a key maps to a known `@font-face` we serve from our origin. If a raw stack is allowed, validate to letters/spaces/commas/quotes only — **no `url()`**, no `@import`. |
| `typography.headingFamily` *(optional)* | `"fraunces"` | Same as `fontFamily`; lets headings differ from body. |
| `typography.baseSizePx` | `16` | Integer, **clamped 12–20** (prevents layout breakage / absurd values). |
| `typography.scale` *(optional)* | `1.2` (modular) or a named set `{sm,base,lg,xl}` | Ratio clamped ~1.1–1.4, or each size clamped to a sane px range. |
| `typography.weight` *(optional)* | `{normal:400, bold:600}` | Enum of standard weights present in the hosted face. |
| `radius` / `density` *(optional)* | `8px` / `comfortable\|compact` | Numeric clamp / enum. |
| `logo` | hosted blob id | **https blob on our storage only** — never an arbitrary tenant URL (SSRF/mixed-content). We ingest the customer's logo at onboarding. |

> **No platform attribution.** The widget renders fully under the customer's own brand — there is **no "Powered by PayMitto" (or "Powered by Mitto") lockup** anywhere in it.

### How fonts are handled (the safe part)
- **Preferred: a curated, self-hosted font allowlist.** We host a small set of popular brand-safe web fonts (e.g. Inter, Roboto, Lato, Source Sans, Fraunces, a system stack) as `@font-face` on **our** origin. The customer picks a key. This keeps `font-src 'self'` — no third-party fetch, no CSP widening, no supply-chain exposure.
- **If a customer needs their exact brand font:** we **ingest it as an asset** at onboarding (they provide the licensed WOFF2; we self-host it per-tenant) rather than pulling from an arbitrary URL. A customer-supplied `fontUrl` is **not** accepted directly. (If ever needed, it would be restricted to `fonts.gstatic.com` and widen `font-src` only for that tenant — flagged for infosec.)
- **Size** is a base px + optional scale, both clamped, so the widget stays legible and unbroken at any setting.

### Delivery & application
1. Onboarding writes a validated `/config/{clientId}.json` (public, no secrets) + ingests logo/font assets we host.
2. The widget fetches it (same-origin) and sets custom properties: `--pm-color-*`, `--pm-font-family`, `--pm-font-heading`, `--pm-font-size-base`, `--pm-radius`, … on `:root`. All widget CSS references these variables; no per-tenant stylesheet is generated.
3. `theme=light|dark|auto` (URL param) selects the light/dark variable set; **brand tokens override the theme defaults.**

### Config vs. embed-URL split
- **Embed URL params** (public, per-page): `theme`, `corridor`, `amount`, `src`, `lang` — ephemeral display state. Fonts/colors are **not** URL params (fonts need `@font-face` loading and validation; a URL is the wrong place).
- **`/config/{clientId}.json`** (per-tenant, validated): the full branding token set above.
- **Optional parent→widget `setTheme` postMessage** (from an `allowedEmbedDomains` origin only) can switch the theme at runtime, but cannot inject new fonts/colors.

### Onboarding tooling
Ship a **branding schema + validator** (same spirit as the color validator we already use) plus a **preview** so onboarding can set a client's palette + type and see the widget before publishing the config. A bad value is rejected at write time, never at render.

---

## 6. Multi-tenant config

- **Public** (Blob `/config/{clientId}.json` + our logos/fonts): **colors (validated tokens), typography (allowlisted/self-hosted font family + clamped size/scale), logo**, `enabledCorridors`, CTA deep-link, theme/locale defaults. **No platform attribution** — the widget renders entirely under the customer's brand. (Full branding token set + validation in §5a.)
- **Secret-ish** (Table Storage, server-only): Sender secret **name**, `allowedEmbedDomains`, source currencies, fee/promo overlay.
- **Secret** (Key Vault): Sender ID **value**, global `client_secret`.
- **Resolution:** every request resolves `clientId` **first**, loads only that tenant's row + named secret; nothing trusts a request-supplied `sender_id`/corridor/branding. Cache partitioned by `clientId` + `srcCcy`. **Isolation is code-enforced → backed by an automated CI test** (client A can never resolve B's secret/domains/blobs; unknown `clientId` rejected). One vault per tenant is the hard-compliance option.

---

## 7. Security posture (review-hardened)

- **Who-can-frame:** dynamic `/embed` emits **per-tenant `frame-ancestors`** (must be an HTTP header, not `<meta>`; never allow-all). *Limit:* stops direct framing, not a rehosting phisher who strips the header — blast radius bounded because the widget only previews rates and the CTA deep-links to the real app. Add off-allowlist load analytics + brand-abuse monitoring.
- **Widget-document CSP:** `script-src 'self'; style-src 'self' 'nonce-…'; font-src 'self'; img-src 'self' https:` — branding can't execute, and fonts load only from our own origin (self-hosted allowlist/ingested faces), so no third-party font fetch widens the policy. Colors/typography are **validated at write time** (§5a) and applied only as CSS custom properties — never as raw injected CSS.
- **CORS:** collapsed away by the single origin; Functions CORS list stays empty.
- **Secrets:** Key Vault + Managed Identity (Key Vault Secrets User). **Rotation runbook:** app-setting Key Vault refs cache ≤24h → overlap old+new validity + force fleet restart, or read that secret at runtime via `SecretClient`.
- **postMessage:** resize/ready are non-sensitive → posted `targetOrigin '*'`; the real gate is parent-side `event.origin`+`event.source` + versioned envelope. Parent→widget config messages accepted only from `allowedEmbedDomains`.
- **PII:** none collected; nothing sensitive in URLs; browser never sees Sender IDs/secrets.
- **Transport/isolation:** TLS everywhere; Storage + Functions behind Front Door via Private Link; consider Front Door **Premium** WAF for a money widget; **Flex VNet** if ReadyRemit needs egress from an allowlisted IP.

---

## 8. Cost (signals — confirm on Azure pricing)

Front Door Standard (low base + per-request; the only CDN) · static host (SWA ~US$9/mo or Blob pennies) · Functions Flex (hourly sweep is ~24 runs/day **independent of tenant count**; `/embed` edge-cached → no per-view billing) · Storage ZRS + Table (pennies) · Key Vault (negligible) · App Insights (modest). **No Redis line item.**

---

## 9. Migration plan

| Phase | Work |
|---|---|
| **0. Provision + confirm** | Answer §10 questions; stand up Front Door, static host, Functions (Flex), Storage (ZRS), Key Vault, App Insights; load `client_secret`; grant MI; wire Front Door routes |
| **1. Lift-and-shift proxy** | Port `netlify/functions/*` → Functions handlers; `client_secret`→Key Vault ref; local dev `func start`; **empirically validate fee linearity** (rule vs ladder) |
| **2. Multi-tenant config + secrets** | Table registry (Riverstone, Keystone); per-tenant Sender IDs → Key Vault; `clientId`-first resolution; public `/config` blobs; **cross-tenant isolation CI test** |
| **3. Hourly rate cache** | TimerTrigger + blob lock; dedup sweep + per-tenant fan-out; `generatedAt`+`schemaVersion`; bootstrap run; metrics + alerts |
| **4. Iframe embed + `/embed`** | Refactor `app.js` → cross-origin widget doc (client-side pricing, staleness guard, per-tenant fallback); dynamic `/embed` (per-tenant CSP, edge-cached by `clientId`); listener + `embed.js` |
| **5. Edge, domains, cutover** | `widget.paymitto.com` + managed TLS + WAF; CI (ship-via-PR); staging validation; DNS cutover from Netlify (keep as rollback one cycle) |

---

## 10. Open questions to confirm (blocking before build)

**ReadyRemit / product:**
1. **Is fee/receive linear in amount?** (fee-rule vs amount-ladder — highest-impact schema decision). Note: the per-quote discount/original fee for promos is **not** inferred — it comes from `GET /v1/quote/{quoteHistoryId}/promotion` (`feeDiscountAmount`, `adjustedFxRateUndiscounted`); 404 when no promo.
2. **Quote quota / rate-limit / SLA** in writing (sizes the sweep).
3. Does `api.readyremit.com` require **egress from a fixed/allowlisted IP**? (forces Flex VNet / Premium)
4. Per-tenant Sender provisioning confirmed (B2C, `kycStatus SKIPPED`) + per-corridor quoting validated in the target env.
5. Dual-currency destination countries — which `destinationCurrency` entry is the display currency? (current "take first" may be wrong)

**Azure / infra:**
6. Static host: **SWA Standard vs Blob static-website**?
7. **Flex Consumption available in the approved region?** (else classic Consumption — loses VNet/always-ready/Node 22)
8. **One shared Key Vault** (code-enforced isolation + CI test) **vs one vault per tenant**?
9. Front Door **Standard vs Premium** (WAF/bot + Private Link)?
10. Region for Functions/Storage/Table/Key Vault (co-locate).
11. Non-secret config in **Table Storage vs App Configuration**?

**Product/compliance:**
12. For production FI tenants, is the illustrative fallback **disabled** (show "temporarily unavailable") or kept but restricted to `enabledCorridors`?
13. Acceptable **staleness window** (assumed ~60 min, guard at 2–3× cron).
14. Source currencies per tenant (USD only, or CAD/GBP/EUR)?
15. Custom domain (`widget.paymitto.com`?) + initial `allowedEmbedDomains` + CTA deep-links for Riverstone & Keystone.
16. Localization scope for `lang` — number/currency formatting only, or translated copy?
