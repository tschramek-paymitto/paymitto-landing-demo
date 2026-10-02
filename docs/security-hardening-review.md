# Hardening & Optimization Review — PayMitto Global Transfers Rate Widget

## Scope & method

**What was reviewed**

- **Current code (live Netlify demo):** `netlify/functions/quote.mjs`, `corridors.mjs`, `_readyremit.mjs`, `_util.mjs`; the helper scripts `verify-oauth.mjs` / `provision-sender.mjs`; the front end `index.html`, `keystone/index.html`, `app.js`, `styles.css`; deploy config `netlify.toml`; and `.env` / version-control hygiene.
- **Target architecture (design):** `docs/architecture-azure-embed-widget.md` — the Azure Static Web Apps + Front Door + Functions + Blob/Table + Key Vault embeddable multi-tenant widget design, including the hourly Timer sweep and the per-tenant `/embed`, `/config`, `/rates` surfaces.

**Dimensions:** secrets & auth; tenant isolation & CORS; embed surface (framing, sandbox, postMessage, CSP); input validation & injection; availability / DoS / cost; and general current-code quality (correctness, robustness, supply-chain).

**Method:** every candidate finding was **adversarially verified against source** — claims were re-checked line-by-line, severities were adjusted down where runtime behavior or existing design controls blunted the stated impact, remediations were tested for architectural soundness, and findings that did not survive were rejected. Of the raw candidate set, **1 was rejected outright** and several were downgraded (notably from the money/multi-tenant framing to the actual sandbox/display-only blast radius). This report presents the surviving, severity-adjusted findings.

> **Finding consolidation note.** Verification produced **40 surviving raw findings**, with substantial overlap (multiple passes flagged the same missing-security-headers, error-echo, XFF, rate-limiter, and quote-param-validation issues). For a readable sign-off document these have been consolidated into **28 findings** with stable IDs; each consolidated finding cites all its underlying evidence. No finding was dropped in consolidation, and severities are unchanged from the verified set.

---

## Summary

**Counts by severity (consolidated):**

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 5 |
| Low | 17 |
| Info | 6 |
| **Total** | **28** |

(Rejected during verification: 1.)

**Top risks**

- **Multi-tenant isolation on the Azure widget is code-enforced, with no platform (RBAC) boundary behind it (SEC-01).** A single global `client_secret` and every per-tenant Sender ID share one Key Vault, and the only thing separating tenants is the correctness of the `clientId → secret-name` code path. The crown-jewel fix is cheap (separate vault for `client_secret`) but not yet decided (open Q8).
- **The embed-surface input contract is unspecified on the design (SEC-02, SEC-03, SEC-04).** `clientId`/`src`/`allowedEmbedDomains`/CTA-URL/cache-key validation and canonicalization are the trust boundary of a money-adjacent embeddable widget, and the design currently validates only branding *values*, not these keys. All are small/medium design-spec hardening items, best folded into the required isolation CI test before build.
- **The current live demo fronts a token-bearing quote proxy with only a best-effort, per-container in-memory rate limiter and ships no security response headers (AVL-01, AVL-02, SEC-06).** Real today, but bounded: credentials are **ReadyRemit sandbox only**, data is **display-only public indicative rates**, no secret reaches the browser, and the Azure design **structurally removes the visitor→token path** by serving a precomputed edge-cached table.

**Overall posture.** No critical or high findings. The current live code is a single-tenant, display-only, sandbox-validated demo whose residual issues are low/info and degrade gracefully; its highest-impact risk classes are already **addressed-in-design**. The target Azure design is sound in its core isolation and secrets posture, and the medium findings are predominantly **design-stage specification gaps** (pin the input/validation/cache/vault contracts) to close before the widget is built — not implemented vulnerabilities. This is a reasonable posture to take into engineering + infosec sign-off, provided the medium items and the residual-risk decisions below are resolved.

---

## Findings

### Medium

#### SEC-01 — Cross-tenant secret isolation is code-only; Key Vault RBAC is vault-wide
- **Layer:** azure-design · **Component:** `docs/architecture-azure-embed-widget.md` §6 (Resolution), §7 (Secrets), §10 Q8 · **Category:** tenant isolation · **Status:** partial · **Effort:** M
- **Impact:** A single shared vault holds the global `client_secret` **and** every per-tenant Sender ID; the Functions Managed Identity is granted the vault-scoped `Key Vault Secrets User` role, which permits `get` on **all** secrets in the vault. The only boundary between tenant A's path and tenant B's Sender ID (or the shared `client_secret`) is the correctness of the code mapping `clientId → secret name`. A name-resolution or coercion bug therefore crosses tenants; there is no platform authorization boundary behind the code, and the CI isolation test is a functional check, not an authorization control.
- **Evidence:** §7 grants the vault-wide role on one shared vault; §6 states isolation is "code-enforced" and itself notes "one vault per tenant is the hard-compliance option"; §10 Q8 leaves the choice open. Realistically the blast radius of a resolution bug is cross-tenant **Sender IDs** (low-sensitivity), **not** the `client_secret`, because per §3 the `client_secret` is loaded via a static `@Microsoft.KeyVault(...)` app-setting reference (fixed URI, resolved at startup) while only Sender IDs use the runtime `clientId`-driven `SecretClient`, and the secret *name* is a stored attribute on the validated registry row — not built from request input.
- **Remediation (remediation reframed — the originally proposed primary fix is unsound):**
  - **Do not** rely on "one vault per tenant" as the isolation fix. The backend is a **single Functions app with one system-assigned Managed Identity** serving all tenants; that identity must hold `Secrets User` on *every* tenant vault anyway, so per-tenant (or per-secret) RBAC recreates the same all-secrets-reachable surface and yields **no** authorization boundary. Only per-tenant *compute + identity* would — a far larger change, not justified for low-sensitivity Sender IDs.
  - **Sound, cheap fix:** keep the global `client_secret` in a **separate Key Vault** from the per-tenant Sender IDs. This works precisely because `client_secret` is loaded via a static app-setting reference while the `clientId`-driven `SecretClient` is pointed only at the Sender-ID vault — a name-coercion bug on the tenant-request path cannot name or reach a secret in a vault that client never targets. This closes the only path to the crown jewel.
  - Keep the code-side controls (the design already largely specifies them): derive the secret name **only** from the validated registry row, never from request input; make the required CI test assert the **negative** (A's path returns no secret for B's name; forged/unknown `clientId` yields none).

#### SEC-02 — Tenant key & embed-domain inputs not strictly validated/canonicalized before use in secret-name, blob path, Table key, CSP header, and edge cache key
- **Layer:** azure-design · **Component:** §5 (`client`/`src`), §4 (`/config/{clientId}.json`, `/rates/{clientId}/{srcCcy}/…`, Front Door edge-cache), §6 (`PartitionKey={clientId}`), §7 (frame-ancestors from `allowedEmbedDomains`) · **Category:** injection / input validation · **Status:** partial · **Effort:** S–M
- *(Consolidates two verification-pass findings on the same input-contract gap: tenant-key charset/canonicalization, and CRLF/`;`/`*` in `allowedEmbedDomains` interpolated into the CSP header.)*
- **Impact:** Without a strict charset/allowlist and canonicalization, a crafted `clientId`/`src` could escape into another tenant's blob/Table partition or secret name, and divergent normalization between Front Door's cache key and the Function could serve tenant A's `/embed` (including A's per-tenant `frame-ancestors`) under tenant B's cache slot. Separately, CR/LF in `allowedEmbedDomains` enables HTTP header injection/splitting from `/embed`, and `;`/`*` can inject or relax CSP directives — neutering the very framing control §7 relies on.
- **Evidence:** §5 calls `client` an "opaque handle" and §6 says "unknown clientId rejected", but no charset allowlist, canonicalization rule, or cache-key canonicalization is specified; §5a's write-time validation table covers only color/typography/logo tokens and omits `allowedEmbedDomains`. Runtime partially blunts the worst paths (Node throws `ERR_INVALID_CHAR` on CR/LF header values; Azure Blob names are literal/flat so `..` is not resolved; a point Table lookup defeats name-injection) — which is why this is a medium hardening gap, not a demonstrated secret-exfil path. The surviving concrete risk is the cache-key canonicalization mismatch and the `;`/`*` CSP-relaxation, the latter self-scoped to a tenant weakening its own framing.
- **Remediation (sound; adopt with the additions):** validate `clientId` against a tight allowlist (`^[a-z0-9-]{1,40}$`) and `srcCcy` against an **ISO-4217 allowlist** before *any* lookup, header, cache key, or blob/path use, at **both** the edge and the Function; reject non-canonical forms rather than normalizing; 404 unknown/malformed `clientId` before resolving config. For `allowedEmbedDomains`/CTA/config strings, validate at **write time and again at header-emit time** (reject CR/LF/`;`/control chars) and **construct `frame-ancestors` programmatically from a parsed host list** (scheme+host+optional port), not free-text concatenation. Require Table lookups to be **point lookups** (PartitionKey+RowKey exact match), never concatenated filter queries — this, not charset alone, is the actual mechanism for the secret-name escape. Set the Front Door cache key to exactly the canonicalized `clientId` plus only body-affecting params. Add `allowedEmbedDomains` to the §5a validation table and fold all of this into the §6 isolation CI test.

#### SEC-03 — CTA deep-link is not scheme/host-validated (only branding tokens are)
- **Layer:** azure-design · **Component:** §5 / §4 (CTA rendered/navigated value), §6 (per-tenant config; CTA listed beside "colors (validated tokens)" with no validation of its own), §5 sandbox (`allow-popups-to-escape-sandbox`) · **Category:** injection / open-redirect · **Status:** open · **Effort:** S
- *(Consolidates the two CTA-URL findings, including the sandbox-escape angle.)*
- **Impact:** The CTA deep-link is a per-tenant config field rendered as the "Send money" anchor (`target=_blank`). It is the **only** config field with no stated validation, while logos are strictly constrained ("https blob on our storage only") and colors are "validated tokens". An arbitrary-`https` CTA turns a branded, FI-trusted widget into an open-redirect / phishing launch point at the high-trust moment of a money flow, and §7 itself leans on "the CTA deep-links to the real app" as a blast-radius bound it never enforces. The `javascript:`/`data:` code-execution angle is largely neutralized (`script-src 'self'` blocks `javascript:` URIs and modern browsers block them for top-level navigation), so the real residual is phishing/open-redirect, bounded by the fact that the CTA is onboarding-set (semi-trusted).
- **Remediation (sound; adopt with the additions):** validate the CTA URL at **write time and render time** — require `https:`, reject `javascript:`/`data:`/`vbscript:`/protocol-relative, and **allowlist the host to the tenant's known app domain / `allowedEmbedDomains`** (this also restores the §7 blast-radius assumption). Render the anchor with `rel="noopener noreferrer"` given `target=_blank`. Note: **do not** blindly drop `allow-popups-to-escape-sandbox` — that flag is what lets the CTA open the real authenticated app as a working browsing context; document/scope it rather than removing it.

#### SEC-04 — `/embed` edge-cache key vs. request query params is unspecified
- **Layer:** azure-design · **Component:** §4.2, §5, §8 (cost property) · **Category:** edge-cache correctness · **Status:** partial · **Effort:** S
- **Impact:** §4.2 claims `/embed` is "edge-cached by clientId … no Function per page view" and §8 bases the no-per-view-billing cost property on it, but the embed URL carries `client, theme, corridor, amount, src, lang` and the doc never specifies the Front Door cache-key config. Two failure branches: if the query string is left at Front Door's **default (Ignore Query String)**, then because `client` is itself a query param, `/embed` would serve the **first tenant's** cached HTML — including its per-tenant `frame-ancestors` CSP — to **all** tenants (a cross-tenant isolation bleed undercutting §6/§7). If instead set to "Use Query String", an attacker varies `amount`/`corridor` to generate unlimited distinct keys → cold-start storm + per-view billing.
- **Evidence:** cache-key behavior is load-bearing and unspecified; §6's "partitioned by clientId+srcCcy" refers to the `/rates` blob paths, not the `/embed` edge cache. (Note: the raw finding's "Front Door default includes the query string" is backwards — the default is *Ignore* Query String, which makes the cross-tenant branch the live default risk.)
- **Remediation (sound):** configure the `/embed` route cache key via **"Include specified query strings"** to include **only `client`** (and `lang` *iff* `lang` drives server-rendered copy — open Q16; otherwise exclude it), and exclude `amount`/`corridor`/`src`/`theme` (theme/amount/corridor/src are applied client-side per §4.3). Explicitly state the key must **not** be left at the Front Door default. `app.js` already reads `amount`/`corridor`/`src` purely client-side, so they never need to vary the HTML.

#### AVL-01 — Token-bearing quote proxy has no global cap on upstream call volume; scraping can exhaust the shared ReadyRemit credential
- **Layer:** current-code (primary) / both · **Component:** `netlify/functions/quote.mjs:21,31,53-58`, `_util.mjs:24-49`, `_readyremit.mjs:68-83` · **Category:** availability / DoS / cost · **Status:** addressed-in-design · **Effort:** M
- *(Consolidates the "no effective cap" and "anonymous quote endpoint drives a sender-scoped-token-authenticated upstream call per request" findings.)*
- **Impact:** The quote cache key includes the **exact amount** (`quote.mjs:53-56`), so varying the send amount by $0.01 yields a unique key per request (~0% cache hit), defeating the 30s TTL the header comment claims "blunts rate-scraping". The only remaining guard is the in-memory, per-container, per-IP limiter (60/min), which is bypassable and not global. Every miss is one authenticated upstream `/quote` on the shared sender-scoped token, with no global ceiling. In production on the shared Brightwell credential this risks throttling/ban by ReadyRemit (a product-wide DoS); **today it is bounded**: credentials are sandbox-only, `/quote` is read-only and moves no funds, no secret reaches the browser, and upstream failure degrades gracefully to an "unavailable" state.
- **Evidence:** verified in code; `_util.mjs` itself concedes the limiter is "not a global guarantee". Correctly **addressed-in-design**: §2/§4 mint the sender-scoped token only inside the hourly Timer sweep and serve visitors a precomputed edge-cached, display-only table — removing the visitor→token path entirely.
- **Remediation (sound):** end state is the Azure precompute design (adopt it). Interim current-code hardening, in combination: (a) a **global/shared-store ceiling** on upstream quote calls per window (not just per-IP), (b) **quantize the amount** into the cache key (round to a ladder/bucket) so scraping collapses onto cached entries — necessary to pair with (a) so a global ceiling does not turn a per-IP DoS into a global one, (c) a **short negative cache** for upstream 4xx. Bucketing is acceptable only because the payload is display-only and the UI confirms the exact amount before sending; alert on `client_id`-level quota since the FX path rides a shared credential.

---

### Low

Fields per finding: **layer · component · category · status · effort — impact / remediation.**

#### SEC-05 — Upstream / OAuth / exception error text echoed to anonymous callers
- both · `quote.mjs:93`, `corridors.mjs:81`, `_readyremit.mjs:55-56` · info-disclosure · open (current code) / partial (design) · S
- *(Consolidates three passes on the same CWE-209 verbose-error path.)* Both functions' catch blocks return `message: String(e?.message || e)`; `getToken` throws an error embedding the **raw upstream OAuth response body** plus status, which propagates to those catches and is reflected verbatim to unauthenticated callers. No secret leaks (a failed token response carries no `client_secret`/access token), but internal/upstream failure modes, provider status text, and the hidden ReadyRemit backend hostname are exposed for reconnaissance. Routine upstream-error paths are already sanitized (`quote.mjs:62-69`, `corridors.mjs:39`), so only genuine exceptions reach the echo.
- **Remediation:** drop `detail` at the throw site (`_readyremit.mjs:56`) and log it server-side only; return a generic `{error:'upstream_unavailable'}` / `{error:'auth_error'}` (502/503) with no `message`. Carry the same hygiene into the ported Azure Functions (§9 Phase 1 is a verbatim port) and add an explicit "no upstream/exception text in client responses" item to §7, which currently omits error verbosity. Keep token-mint failure logs access-controlled.

#### SEC-06 — Live Netlify demo ships no security response headers (framing, CSP, HSTS, nosniff)
- both · `netlify.toml` (no `[[headers]]` block; no `_headers` file); `index.html` / `keystone/index.html` (no meta directives) · clickjacking / CSP · partial / addressed-in-design · S
- *(Consolidates five passes on the missing-headers / clickjacking observation.)* Verified: `netlify.toml` defines only build/functions/redirects, there is no `_headers` file, and grep finds no `X-Frame-Options`/`frame-ancestors`/CSP/HSTS/`nosniff` anywhere. The public, brand-carrying pages (Riverstone/Keystone) are therefore framable by any origin. **Low** because the pages are static, unauthenticated, display-only, with no session/cookies and no state-changing click target (CTAs deep-link out or are inert `href="#"`); the real residual is brand-rehosting/phishing and infosec's baseline-headers expectation on a money-adjacent surface. The design (§7) replaces this with per-tenant `frame-ancestors` on `/embed`, so the production layer is addressed.
- **Remediation:** add a `netlify.toml` `[[headers]]` (or `_headers`) block **site-wide**: `X-Frame-Options: DENY`/`SAMEORIGIN` (legacy backstop) plus a CSP with `frame-ancestors 'none'`/`'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Strict-Transport-Security` (HTTPS-only site). These must be **HTTP headers**, not `<meta>` (XFO/HSTS cannot be set via meta). A complete baseline CSP must whitelist the two Google Fonts origins (`fonts.googleapis.com`, `fonts.gstatic.com`) and handle the one inline `style=` attribute, or the calculator breaks; the pages are otherwise CSP-friendly (no inline `<script>`). Also emit `nosniff` on the `/api/*` JSON responses (the `json()` helper in `_readyremit.mjs:89`), since `_headers` governs static assets only.

#### SEC-07 — Rate-limit identity trusts client-controlled `X-Forwarded-For`
- both · `_util.mjs:13-21` (consumed by `quote.mjs:31`, `corridors.mjs:23`) · DoS / input · open (code) / partial (design) · S
- *(Consolidates the two XFF findings.)* `clientIp()` prefers the platform-set `x-nf-client-connection-ip` but **falls back to the first `x-forwarded-for` entry**. On Netlify the trusted header is injected by the edge on every externally-routed invocation and cannot be spoofed, so the fallback branch is **effectively unreachable in the live deployment** — hence low, not a live bypass. It is a latent hardening gap that becomes exploitable under platform migration, self-hosting behind a different proxy, or local/misconfigured deployments.
- **Remediation (sound):** never fall back to a client-supplied header for a security decision — if `x-nf-client-connection-ip` is absent, bucket under a single `unknown` key (fail-closed); in practice this is just deleting `_util.mjs:18-19` (line 20 already returns `unknown`). In Azure, derive client IP only from the Front Door-injected header and strip inbound XFF at the edge; state this in §7. Per-IP Function limiting is secondary in the Azure design (static edge-cached visitor path, no token proxy).

#### SEC-08 — Public quote proxy forwards request params unvalidated, with an un-normalized cache key
- current-code · `quote.mjs:38-61` · input validation · open · S
- *(Consolidates the two quote-param-validation findings.)* `transferMethod`, `quoteBy`, the three ISO codes, and `amount` are read from the query string with only a presence check and forwarded to upstream; `amount` is passed as an arbitrary string, and the cache key is built from raw strings (`'500'` vs `'0500'` vs `'500.0'` are distinct keys). **No injection is actually reachable** (`searchParams.set` percent-encodes, keys and path are fixed) and the upstream rejects bad enums as a benign `unavailable` — so this is defense-in-depth plus cache-cardinality, not an exploit. Risk is carrying the raw-forward pattern into the multi-tenant build where corridor/amount must be constrained to the tenant's `enabledCorridors`.
- **Remediation (sound):** validate before proxying — `transferMethod`/`quoteBy` against fixed enums; ISO codes against `^[A-Z]{3}$`; `amount` against `^[0-9]{1,12}$` with a sane max (align to ReadyRemit's per-corridor limits, already surfaced as `MaxLimitOutOfRange`); normalize `amount` to an integer before building the cache key. Prefer the format regexes as the durable defense (a hardcoded enum allowlist risks drift vs. what `/corridors` advertises — ideally derive it from the corridors source of truth). Ensure the Phase-1 lift-and-shift does not reintroduce raw request→upstream forwarding (§2/§4 retire this path).

#### SEC-09 — `client_secret` rotation runbook under-specifies emergency revocation given the 24h app-setting cache
- azure-design · §7 (rotation runbook), §6 (secret classification) · secret rotation · partial · M
- `client_secret` is loaded as an app-setting Key Vault reference (`cache ≤24h`); the runbook describes planned overlap rotation + forced restart but not the compromise/incident path. On confirmed compromise, revocation effectiveness is bounded by both ReadyRemit invalidating the old secret **and** an Azure forced restart — easy to get wrong for the one credential whose blast radius is every tenant.
- **Remediation (sound):** prefer **Option A** — read `client_secret` at runtime via `SecretClient` (the pattern already chosen for Sender IDs); since it is exercised only once per hour in the sweep, Azure-side switchover drops from ≤24h to ≤~1h, and it removes the unexplained inconsistency between the two secret-loading paths. Otherwise document an explicit emergency-revocation runbook (rotate → force fleet restart → verify old secret rejected upstream) with a stated RTO. The true revocation bound is **upstream provider invalidation**, not Azure cache expiry — state this for infosec.

#### SEC-10 — `frame-ancestors` is the only anti-framing control; a rehosting phisher that strips the header is unprotected
- azure-design · §7 (Who-can-frame) · embeddability · addressed-in-design (accepted) · M
- `frame-ancestors`/XFO only bind a browser loading *our* document; a rehosting/proxying phisher serves their own copy, so our headers never travel with it. Impact is bounded and explicitly accepted: display-only, no PII/auth, CTA opens the real app in a new tab.
- **Remediation (partly reframed — originally proposed fix is partly unsound):** make **external brand-abuse / lookalike-domain monitoring + takedown a mandatory deliverable** — it is the only element that actually addresses rehosting. **Reclassify** "pin the CTA to the verified tenant origin" as defense-in-depth for the *genuine* widget (a rehoster controls its own CTA and never loads our config, so pinning does nothing against a clone). Document that "off-allowlist load analytics" catches **hotlinking/unauthorized iframe embeds**, not full static clones/proxies (where our JS never runs).

#### SEC-11 — Widget-document CSP is under-specified for a money widget
- azure-design · §7 (widget-document CSP, §7 L164) · CSP · partial · S
- The policy currently specifies `script-src 'self'; style-src 'self' 'nonce-…'; font-src 'self'; img-src 'self' https:` but has **no** `default-src`, `connect-src`, `object-src`, `base-uri`, or `form-action`, which fall back to allow-all. (Framing note for reviewers: `font-src`/`img-src` *are* already present — treat this as *complete the CSP*, not "only script/style exist.") Bounded impact — `script-src 'self'` already blocks injected script and the widget holds no secrets/PII — so this is deny-by-default hygiene, not an exploitable hole; `connect-src 'self'` (exfil containment) and `default-src 'none'` are the load-bearing additions.
- **Remediation (sound):** adopt as the normative header contract: `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-…'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors <per-tenant>`. Tighten `img-src 'self' https:` → `img-src 'self'` (logos are self-hosted).

#### SEC-12 — Reflected URL params (`theme`/`lang`) not validated against enums before DOM use
- azure-design · §5 / §4 · injection · partial · S
- `client/theme/corridor/amount/src/lang` drive branding/rendering; `amount` is numerically sanitized and `client/corridor/src` resolve against cached data, but `theme`/`lang` have no stated allowlist. Low because the widget's `script-src 'self'` CSP backstops DOM-XSS; defense-in-depth is expected on a multi-tenant embeddable surface.
- **Remediation (sound):** validate `theme ∈ {auto,light,dark}` and `lang` against a locale allowlist at widget boot, fall back to defaults on mismatch, encode any reflected value and never build markup from it. Because `/embed` is edge-cached by `clientId` (not theme/lang), these are consumed client-side only, so boot-time validation is the correct layer. Write it into the design as a hard requirement (§5a/§7 mandate write-time validation of branding but not read-time validation of URL params); if `/embed` ever bakes these into server HTML, add server-side encoding too.

#### AVL-02 — In-memory per-container rate limiter is not a global limit
- both · `_util.mjs:24-49` (also `:3-9,27-49`) · DoS · addressed-in-design · M
- *(Consolidates the two per-container-limiter findings.)* `hits` is a module-scope Map local to each warm container; the effective ceiling is 60/min (quote) / 30/min (corridors) **× warm-container count**, reset on cold start. A distributed/burst load scales out containers and the ceiling scales with it. Bounded today (sandbox, display-only, no secrets to browser); the real asset at risk is the shared upstream token quota.
- **Remediation (sound, with a caveat):** back the limiter with a **shared store** (Redis/Upstash preferred for atomic `INCR`+TTL; Netlify Blobs is eventually-consistent and race-prone — not the default for a hard limit); call sites already abstract this. A shared per-IP store does **not** stop IP rotation, so pair it with a **global budget / circuit-breaker on the upstream token** and (via SEC-08/AVL-01) remove the raw amount from the cache key. The Azure design resolves this structurally (static edge-cached visitor path, token minted only in the hourly sweep); visitor-side abuse becomes a Front Door/WAF concern (consider Premium WAF for a money widget).

#### AVL-03 — No timeout on upstream `fetch` calls
- current-code · `_readyremit.mjs:41-52,76-78` · DoS · open · S
- Both the token POST and the authenticated GET call `fetch` with no `AbortController`/signal/timeout (undici `fetch` has no total-request timeout), so an upstream hang stalls each invocation to Netlify's function timeout, consuming concurrency and billed duration precisely when upstream is unhealthy. Bounded today (token cached ~24h so the POST path is ~once/cold-container; GET behind TTL cache + rate limiter; two-page demo).
- **Remediation (sound):** wrap both fetches in an `AbortController` with an aggressive timeout (3–5s) and return the existing 502/unavailable path on abort (the signal also aborts the subsequent `res.text()`/`.json()` body read, covering slow-body cases); this also bounds billed duration. In Azure, scope the timeout to the **hourly sweep** (the only upstream caller there) as low-priority hardening — the visitor path never calls upstream.

#### AVL-04 — No single-flight / stampede protection on the TTL cache
- current-code · `_util.mjs:52-69`, `quote.mjs:57`, `corridors.mjs:31-33` · DoS / cost · partial (addressed-in-design) · S
- `TTLCache` has no request coalescing, so concurrent misses on the same key each call upstream. **Verified minor** and the proposed fix is unsound as written: Netlify Functions run one request per container (AWS Lambda model), so a container never holds two simultaneous in-flight requests — an **in-memory promise coalesces almost nothing**, and the real fan-out is cross-container, which it cannot touch. Existing per-IP limits + the module-scoped OAuth token cache already bound avoidable cost; §2 of the design removes the visitor-path upstream call entirely.
- **Remediation (reframed):** **do not** implement in-memory single-flight as proposed. Track this as **resolved-by-design** (the Azure precompute model closes it). If cross-container dedup were ever wanted on current code, it requires a shared store backing the cache, not a per-process promise.

#### AVL-05 — `manifest.json` pointer cache-control unspecified — long TTL hides the hourly refresh and can trip the staleness guard
- azure-design · §4 (Rate cache row; hourly refresh / visitor steps) · edge-cache correctness · open · S
- Rate blobs are `Cache-Control public, max-age=3600` and the sweep "flips" `manifest.json` to the new `{epoch}.json`, but the **pointer's** cache-control is never specified. If it inherits 3600s, edge/browser caches keep serving the old pointer for up to an hour after each sweep — refresh becomes invisible (effective freshness ~2h), and the aging `generatedAt` can flip the client staleness guard to "temporarily unavailable" even though a fresh table exists. Bounded (display-only indicative rates; staleness window is an open tuning parameter, Q13).
- **Remediation (sound):** make `{epoch}.json` effectively immutable (`max-age=31536000, immutable` — epoch is in the path) and serve `manifest.json` with a short `max-age` (30–60s) or ETag revalidation; state the pointer cache-control explicitly in §4.

#### ROB-01 — OAuth token cache poisoned for up to an hour by a malformed token success response
- current-code · `_readyremit.mjs:59-64` · robustness · open · S
- `getToken` caches any 2xx without validating the body: a `200` whose JSON **omits** `access_token` sets `cachedToken.value = undefined` with `expiresAt` 1h out, after which `getToken` returns `undefined` for the hour and every `/quote`/`/corridors` sends `Authorization: Bearer undefined`, with no retry on that warm container. (Evidence correction: an *empty/HTML* body does **not** poison — `res.json()` throws and the entry is never set; only a parseable-JSON-without-`access_token` body does.) Bounded: display-only, graceful fallback to clearly-labeled illustrative rates, self-heals within ~1h, one container. The design's per-run local token (§4) is not exposed this way.
- **Remediation (sound):** `if (!data.access_token) throw` before assigning `cachedToken`; also emit a server-side log/metric on token-mint failure (the one real operational gap is the absence of any alarm). Apply the same guard to the Azure sweep's mint as belt-and-suspenders.

#### COR-01 — Client minor-unit conversion hardcodes 2 decimal places while the source currency is server-driven
- current-code · `app.js:308` (`Math.round(send*100)`), with `SRC_CCY` set from the server at `app.js:409` · correctness · partial · S
- The send amount is converted to minor units with a hardcoded `*100`, but `SRC_CCY` is overwritten from the server response and never consulted. Currently correct (all configured source currencies — USD/CAD/GBP/EUR — are 2dp), but a 0-dp (JPY) or 3-dp (KWD) source currency would send amounts off by 100×/10× under a "Live indicative rate" label. (Design-layer note: the Azure visitor flow computes `receive = send × rate` in **major** units with no minor-unit round-trip, so it does **not** directly inherit this; the place to assert source-decimal correctness there is the sweep's minor→major normalization.)
- **Remediation (reframed — originally proposed fix is incomplete):** an `app.js`-only change is insufficient — `corridors.mjs:63` currently emits only a **destination** `decimalPlaces`; there is no source-currency decimals field. Extend `corridors.mjs` (and the config/quote contract) to emit the **source** currency's `decimalPlaces`, then compute `Math.round(send * 10**srcDp)`. Add a guard/test that fails safely (reject/dash) if `SRC_CCY` resolves to a currency whose decimals the client cannot determine, rather than silently assuming 2.

#### COR-02 — Dual-currency corridors silently collapse to the first currency
- both · `corridors.mjs:49-51` · correctness · partial · M
- For a country enabled in two destination currencies, only `destinationCurrency[0]` is surfaced and `byCountry` is keyed by `iso3` alone, so the second currency is dropped and the widget quotes with whichever won. The design flags this unresolved (§10 Q5). **Narrowed impact:** the pipeline is internally consistent — `quote.mjs:80-82` echoes the real quote's `receiveCurrency`/`receiveDecimals` and `app.js:327` renders those — so no mismatched label/number or fabricated rate occurs; the defect is display-only (one of two valid payout currencies is offered, array-order-dependent, and the visitor cannot pick the other).
- **Remediation (sound):** key the grouping by `(iso3, currencyIso3)` and expose each enabled currency as a selectable option, or make the display currency an explicit per-tenant config choice. `quote.mjs` needs no change. Resolve §10 Q5 **before** freezing the Azure rate-blob schema, which otherwise bakes in the same take-first ambiguity.

#### COR-03 — Promo expiry is gated on the viewer's local clock with no server enforcement
- both · `app.js:211-213` · correctness · open · S
- `new Date(PROMO.endsOn + "T23:59:59")` has no timezone offset, so it parses in each viewer's local time — the promo ends at a different wall-clock instant per timezone, and a user who sets their clock back re-enables an expired $0-fee display. Display-only (the real fee comes from the quote; actual charging happens in the authenticated app), so a faked clock only misleads the manipulator; the genuine defect is the inconsistent global end time. **Evidence correction:** the default `endsOn` is `2026-12-31` with `active:true`/`price:0` (not `2026-08-31`), so the default ships an **active** promo as of today.
- **Remediation (sound):** anchor expiry to an explicit instant (compare in UTC, or append an offset — UTC is cleaner than a fixed `-05:00` which ignores DST). If the promo price ever becomes binding rather than cosmetic, gate it server-side in the hourly sweep's blob fan-out (§4), where the fee/promo overlay is already written server-side.

#### SC-01 — Node runtime version is not pinned for the functions
- current-code · `package.json` (no `engines`); `netlify.toml` (no `NODE_VERSION`) · supply-chain · open · S
- Neither file pins the Node version, and the functions rely on platform globals (`fetch`, `URL`); a Netlify default-runtime bump could change `fetch`/HTTP error semantics with no diff to review. (Correction: the "Intl money-display" example is wrong — the only `Intl.NumberFormat` runs in the browser; server money handling is plain arithmetic. The real risk is `fetch`/error-classification drift.) No active defect.
- **Remediation (sound):** pin via `package.json "engines": {"node":"22.x"}` and/or `NODE_VERSION` in `netlify.toml [build.environment]` to match the stated Azure Node 22 target; add a matching `.nvmrc` for local-dev parity.

---

### Info

#### INF-01 — postMessage resize posted with `targetOrigin '*'`
- azure-design · §7 (widget→parent contract) · postMessage · addressed-in-design · S
- Resize/ready messages post with `targetOrigin '*'`; the real gate is the parent-side `event.origin`/`event.source` check plus a versioned envelope, and the payload is a single non-sensitive height integer exposed only to a frame that already controls the iframe. Inbound parent→widget messages are separately gated to `allowedEmbedDomains`, so the loose outbound origin grants nothing.
- **Remediation:** optionally narrow the outbound `targetOrigin` to the resolved parent origin; keep the parent-side gate as the primary control. Note a cross-origin widget cannot read its parent's origin, and a tenant may register multiple `allowedEmbedDomains` — so "resolved parent origin" must come from `document.referrer`/`ancestorOrigins` or be handled per allowed origin; the parent-side gate must remain the real control.

#### INF-02 — CTA `target=_blank` without stated `rel=noopener/noreferrer`
- azure-design · §5 (CTA + sandbox `allow-popups-to-escape-sandbox`) · tabnabbing · open · S
- Reverse-tabnabbing is already browser-default-mitigated (`target=_blank` implies `noopener` since ~2021) and the destination is PayMitto's own app; the iframe already sets `referrerpolicy="strict-origin-when-cross-origin"`. Essentially nil residual — defense-in-depth hygiene.
- **Remediation:** set `rel="noopener noreferrer"` explicitly and document it in the embed contract. **Keep** `allow-popups-to-escape-sandbox` — it is required so the CTA opens the real authenticated app as a working context; note `noreferrer` strips the Referer header (may break the tenant app's attribution — prefer `rel="noopener"` alone if attribution is wanted).

#### INF-03 — Blob single-instance sweep lock needs a bounded lease TTL, not just the staleness alert
- azure-design · §4 (hourly refresh single-instance lock / keep-last-good) · availability · partial · S
- The design specifies a "Blob single-instance lock" but not a lease duration/renewal. If the holder dies mid-sweep holding a long/infinite lease, later runs cannot acquire it; the dead-man staleness alert detects but does not auto-recover. **Low-probability, internal, non-exploitable**, and the stale consequence is already triply mitigated (keep-last-good, never-write-empty, client staleness guard + alert).
- **Remediation:** prefer the built-in Azure Functions **timer-trigger singleton** (short renewed storage lease that self-heals) over a hand-rolled lock; if hand-rolled, use a bounded, renewed lease (15–60s) and release it in a `finally`. State which mechanism is used in §4.

#### INF-04 — Concurrent token misses cause a thundering herd; no retry/backoff on token fetch
- current-code · `_readyremit.mjs:37-52` · efficiency · open · S
- No in-flight promise de-dup and no retry/backoff on transient token-endpoint failure. **Minor and largely non-issue under Lambda** (one request per container, so no intra-container herd; the token is cached ~24h). Not a correctness bug.
- **Remediation (reframed — proposed fix is unsound as written):** naive in-flight promise caching would **poison every caller on one rejection** and buys near-zero benefit under one-request-per-container. If done at all: a **bounded, latency-capped single retry with jittered backoff** on 5xx/network (failing fast to the illustrative-rate fallback), and any cached in-flight promise must be **deleted in `finally`/`catch`** so failures don't stick. Cross-container dedup would need a shared store.

#### INF-05 — Dead no-op ternary in rate display; zero-decimal currencies render rate with hardcoded 2 dp
- current-code · `app.js:177` (`fmt(rate, dp === 0 ? 2 : 2)`) · dead-code · open · S
- Both ternary branches evaluate to 2 (dead code); FX rate for 0-dp currencies (COP/NGN/VND/KES) renders at 2 dp. Purely cosmetic — the `dp` value is used correctly for the actual receive amount, so no money miscalculation.
- **Remediation:** replace with a real choice (`fmt(rate, 2)`, or `fmt(rate, rate >= 100 ? 2 : 4)`) and document intent. Do **not** reuse the currency's own `dp` for the rate line (would drop rate precision, e.g. "130 KES").

#### INF-06 — Live sandbox credentials sit in a plaintext working-tree `.env`; confirm Netlify preview env scoping
- current-code · `.env`, `netlify.toml` · secret hygiene · open · S
- `.env` holds real **sandbox** `READYREMIT_CLIENT_ID`/`SECRET`/`SENDER_ID` in cleartext (expected for local `netlify dev`; correctly git-ignored and absent from history). Separately, `netlify.toml` does not scope env vars, so by default they are available to **public Deploy Preview URLs** — a preview (including a malicious fork PR, whose function code can read `process.env`) would run the live functions with the sandbox token. Sandbox-only, so no production funds/PII.
- **Remediation:** scope `READYREMIT_*` to **Production** (and specific branches), or password-protect previews; rotate the sandbox `client_secret` as unconditional hygiene for a secret that has sat on disk. The Azure design moves these to Key Vault + Managed Identity (§1/§6) — the correct target; state explicitly that non-production/preview builds are **not** granted the Managed Identity role / Key Vault access (the token-minting Timer job is not part of preview builds, which already helps but is not called out as a preview-scoping control).

---

## Optimization recommendations (performance / cost)

Separated from the security findings; several cross-reference the findings above where a control also has a cost dimension.

1. **Adopt the Azure precompute model as the primary cost control (verified sound).** The hourly sweep quotes the **union** of enabled corridors once per (source currency, ladder point) and fans out per-tenant by filtering + overlay, so cost is `O(corridors × ladder × srcCcy)` and **independent of tenant count** (not `97 × N`). This is the single most important cost lever and removes the per-view/per-keystroke upstream calls entirely.
2. **Pin the `/embed` edge-cache key (SEC-04)** so page views are served from the edge rather than executing the Function — this is both a correctness and a per-view-billing control; mis-set either way inflates cost or breaks isolation.
3. **Quantize the quote cache key to amount buckets (AVL-01/SEC-08).** The exact-amount key currently yields ~0% hit rate; bucketing collapses scraping and legitimate round-number traffic onto cached entries, cutting upstream call volume and cost. Pair with a negative cache for upstream 4xx.
4. **Set `{epoch}.json` immutable / long-cache and `manifest.json` short-cache (AVL-05)** so blobs are served maximally from cache while refreshes stay promptly visible — maximizes edge offload without hiding the hourly update.
5. **Add upstream `fetch` timeouts (AVL-03)** — bounds billed function duration and concurrency consumption during upstream slowness, in addition to its availability benefit.
6. **Do not add in-memory single-flight (AVL-04) or in-memory token-herd de-dup (INF-04)** — ineffective under the one-request-per-container runtime; treat as resolved-by-design. Spend the effort on the shared-store limiter / upstream budget instead.
7. **Already-good, keep:** module-scope OAuth token cache with 60s early refresh; `corridors` responses `public, max-age=300` (quote correctly `no-store`); client-side 350ms debounce + `reqSeq` out-of-order guard; slim display-only payloads on both layers; bounded in-memory structures (`hits` capped at 5000, `TTLCache` at 2000); **zero runtime dependencies** in `package.json` (no dependency tree to pin/audit).

---

## Verified-sound / coverage

Areas checked and found OK (so reviewers see coverage, not only problems):

**Secrets & auth**
- `client_secret` / Sender ID / bearer token **never reach the browser** — `quote.mjs:75-88` and the `corridors.mjs:56-65` payloads are explicit display-only allowlists; grep of all front-end files finds zero references to secret/token fields. The token lives only in module scope, sent only as an `Authorization` header upstream.
- Failed token is **not** negatively cached (`_readyremit.mjs` throws before the cache assignment), so a failed mint is never served; the next request re-mints.
- Token expiry margin is sound (60s early refresh against a ~24h token; 1h default when `expires_in` absent).
- Secrets are never logged; `verify-oauth.mjs` prints only a truncated `client_id` and token *length*; `provision-sender.mjs` prints no secret.
- `.env` hygiene is correct — git-ignored, untracked, never committed; `.env.example` holds placeholders only; `client_secret` sourced only from `process.env`.
- No request-supplied `sender_id` or token scoping is trusted — sender scope derives solely from server-side env.
- **Design** structurally removes the token-store risk classes (token minted as a discarded local in the hourly sweep; no shared token store) and keeps secrets out of URLs and the visitor path.

**Tenant isolation & CORS**
- Current code: sender/client scope is not request-supplied; **no CORS headers emitted anywhere** (same-origin only — no wildcard, no wildcard-with-credentials); browser receives only whitelisted display payloads; TTLCache values are always the upstream's own answer for the exact key (no cross-caller poisoning in the single-tenant deployment).
- Design: CORS collapses to the single public origin (`widget.paymitto.com`), Functions CORS list stays empty; `clientId`-first resolution trusts no request-supplied sender/corridor/branding; `/rates` and `/config` are **intentionally public display-only** blobs (cross-tenant *read* of rates is not a confidentiality breach by design); the isolation CI test is a required deliverable; postMessage posture is sound (non-sensitive payload, parent-side origin+source gate, `allowedEmbedDomains` gate for inbound config).

**Embed surface**
- `sandbox="allow-scripts allow-same-origin"` is safe here (widget is cross-origin to the FI); `allow-top-navigation` deliberately omitted; `frame-ancestors` correctly delivered as an HTTP header (never `<meta>`, never allow-all); robust parent-side postMessage listener example; runtime logo serving is SSRF-safe (PayMitto-hosted from Blob, not hotlinked); branding colors are validated tokens; no PII collected.
- `app.js` `innerHTML` sinks (`:234,:239`) only receive numeric `money()`/`Intl.NumberFormat` output (typeof-number guards + numeric coercion); country/method lists use `textContent`; the amount input is numerically sanitized.

**Input validation & injection**
- JSON parse safety (all `JSON.parse` wrapped in try/catch; no `eval`/`Function`, no untrusted reviver); no prototype pollution (explicit field assignment, no untrusted deep-merge/bracket-assign); no ReDoS (all regexes linear; `clientIp` uses `String.split`, no regex); SSRF/param-injection safe in the proxy (fixed path literals + `searchParams.set` percent-encoding); same-origin-only (no `Access-Control-Allow-Origin`); out-of-order response handling via `reqSeq`.

**Availability / DoS / cost**
- Sweep cost is tenant-count-independent (see Optimization #1); the stale-cache dead-man's-switch is genuinely covered (keep-last-good, never-write-empty, alert, client-side staleness guard, per-corridor stale counts); payloads trimmed on both layers; debounce + out-of-order guard; module-scope token cache; `corridors` edge-cacheable while `quote` stays `no-store`.

**Current-code quality**
- Version-control secret hygiene verified clean across all history; `reqSeq` guard correct (single-threaded JS); floating-point money math is display-only and safe (single division, fixed-digit `Intl` rendering, actual charging elsewhere); zero-dependency supply chain; scripts never print secrets; quote soft-error classification correct (business 4xx surfaced as a benign `unavailable`, never a fake number under the live label); the iframe sandbox reasoning is sound.

---

## Residual risk & assumptions for infosec

These depend on infra confirmation or are accepted trade-offs; please review and sign off explicitly:

1. **Single Key Vault / single Managed Identity (SEC-01, open Q8).** Isolation between tenants is **code-enforced**, with no RBAC boundary behind the `clientId → secret-name` path. Accepted only if SEC-01's cheap fix (separate vault for `client_secret`) is adopted and the negative isolation CI test is a hard gate. Per-tenant vaults do **not** add a boundary under the single-identity design — do not treat that as the mitigation.
2. **`frame-ancestors` vs. rehosting (SEC-10, accepted).** The design cannot stop a phisher who rehosts/proxies the widget under their own domain. Accepted because the widget is display-only, holds no auth/PII, and the CTA opens the real app — **conditional on** brand-abuse/takedown monitoring being funded as a mandatory, ongoing deliverable.
3. **In-memory per-container rate limit (AVL-01, AVL-02, SEC-07).** The current live limiter is best-effort and bypassable by scale-out and (latently) by XFF. Accepted for the **sandbox demo**; for any production/shared-credential exposure, the shared-store limiter **and** an upstream-token global budget must land first. Confirm ReadyRemit's quota/SLA on the shared Brightwell credential (open Q2) — this is the hinge that decides whether AVL-01 is low or material.
4. **Netlify preview env scoping (INF-06).** Confirm that `READYREMIT_*` are **not** exposed to public Deploy Previews / fork-PR builds; rotate the on-disk sandbox secret. In Azure, confirm preview/non-prod deploys are not granted Key Vault access.
5. **Open design questions that change finding severity if resolved the wrong way:** Q5 (dual-currency display currency — COR-02, resolve before freezing the rate schema), Q13 (staleness window tuning — AVL-05), Q16 (whether `lang` drives server-rendered copy — SEC-04 cache key).
6. **Sandbox vs. production framing.** Every current-code finding was rated against the **ReadyRemit sandbox, display-only** deployment. Promotion to production with the shared live credential re-opens the shared-credential blast-radius framing on AVL-01/AVL-02/SEC-07 and should trigger a re-rating.