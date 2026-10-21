/* ==========================================================================
   PayMitto demo — interactivity
   Rate calculator (live FX via /api/quote), mobile nav, promo ribbon, reveal.

   The calculator prefers REAL quotes from the PayMitto quote API, exposed
   through two same-origin serverless endpoints:
     GET /api/corridors  -> the destinations THIS client actually supports
     GET /api/quote      -> a real-time quote for one corridor + amount
   When those are unavailable (e.g. a plain static preview with no function
   runtime, or an upstream hiccup) it silently falls back to the illustrative
   table below, so the page always renders something sensible.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     Illustrative FX data (1 USD = rate). Fallback only — not real-time.
     --------------------------------------------------------------------- */
  var FALLBACK = [
    { name: "Mexico",         iso3: "MEX", ccy: "MXN", rate: 17.15,  dp: 2 },
    { name: "India",          iso3: "IND", ccy: "INR", rate: 83.30,  dp: 2 },
    { name: "Philippines",    iso3: "PHL", ccy: "PHP", rate: 56.40,  dp: 2 },
    { name: "Guatemala",      iso3: "GTM", ccy: "GTQ", rate: 7.78,   dp: 2 },
    { name: "Honduras",       iso3: "HND", ccy: "HNL", rate: 24.70,  dp: 2 },
    { name: "Colombia",       iso3: "COL", ccy: "COP", rate: 3955,   dp: 0 },
    { name: "Nigeria",        iso3: "NGA", ccy: "NGN", rate: 1485,   dp: 0 },
    { name: "Vietnam",        iso3: "VNM", ccy: "VND", rate: 24550,  dp: 0 },
    { name: "Kenya",          iso3: "KEN", ccy: "KES", rate: 129.5,  dp: 0 },
    { name: "Canada",         iso3: "CAN", ccy: "CAD", rate: 1.36,   dp: 2 },
    { name: "United Kingdom", iso3: "GBR", ccy: "GBP", rate: 0.79,   dp: 2 },
    { name: "Germany",        iso3: "DEU", ccy: "EUR", rate: 0.92,   dp: 2 },
    { name: "Brazil",         iso3: "BRA", ccy: "BRL", rate: 4.97,   dp: 2 }
  ];

  // Flag emoji by ISO-3166 alpha-3 (the quote API doesn't return flags).
  var FLAGS = {
    MEX: "🇲🇽", IND: "🇮🇳", PHL: "🇵🇭", GTM: "🇬🇹", HND: "🇭🇳", COL: "🇨🇴",
    NGA: "🇳🇬", VNM: "🇻🇳", KEN: "🇰🇪", CAN: "🇨🇦", GBR: "🇬🇧", DEU: "🇩🇪",
    BRA: "🇧🇷", DOM: "🇩🇴", SLV: "🇸🇻", ECU: "🇪🇨", PER: "🇵🇪", USA: "🇺🇸",
    FRA: "🇫🇷", ESP: "🇪🇸", ITA: "🇮🇹", IRL: "🇮🇪", POL: "🇵🇱", PRT: "🇵🇹",
    CHN: "🇨🇳", PAK: "🇵🇰", BGD: "🇧🇩", NPL: "🇳🇵", LKA: "🇱🇰", IDN: "🇮🇩",
    THA: "🇹🇭", GHA: "🇬🇭", ETH: "🇪🇹", UGA: "🇺🇬", TZA: "🇹🇿", ZAF: "🇿🇦",
    EGY: "🇪🇬", MAR: "🇲🇦", JAM: "🇯🇲", HTI: "🇭🇹", NIC: "🇳🇮", CRI: "🇨🇷",
    ARG: "🇦🇷", CHL: "🇨🇱", AUS: "🇦🇺", NZL: "🇳🇿", JPN: "🇯🇵", KOR: "🇰🇷",
    TUR: "🇹🇷", UKR: "🇺🇦", RON: "🇷🇴", ROU: "🇷🇴"
  };
  var flagFor = function (iso3) { return FLAGS[iso3] || "🌐"; };

  // Flag emoji from an ISO-3166 alpha-2 code (regional-indicator letters) —
  // the live corridors carry iso2, which covers every country the ISO3 map may
  // miss. Falls back to the ISO3 map, then a globe.
  function flagFromIso2(iso2) {
    if (!iso2 || iso2.length !== 2 || !/^[A-Za-z]{2}$/.test(iso2)) return null;
    var cc = iso2.toUpperCase();
    return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65);
  }
  function flagF1(d) { return flagFromIso2(d && d.iso2) || flagFor(d && d.iso3); }

  // UI delivery method  <->  quote-API transferMethod enum.
  var METHOD_LABELS = {
    BANK_ACCOUNT:  "Bank account",
    PUSH_TO_CARD:  "Debit card deposit",
    CASH_PICKUP:   "Cash pickup",
    MOBILE_WALLET: "Mobile wallet"
  };
  // Fallback rows have no method data; offer the classic three.
  var FALLBACK_METHODS = ["BANK_ACCOUNT", "PUSH_TO_CARD", "CASH_PICKUP"];
  var FALLBACK_ETA = {
    BANK_ACCOUNT:  "1–2 business days",
    PUSH_TO_CARD:  "Within minutes",
    CASH_PICKUP:   "Same day, most locations"
  };

  // Humanize a deliverySLA from a live quote. The API returns it as an OBJECT
  // ({ id: "INSTANT", name: "instant" }); older doc samples showed a bare
  // string — accept either, and never throw on an unexpected shape.
  function slaText(sla, method) {
    if (sla && typeof sla === "object") sla = sla.id || sla.name || null;
    if (!sla || typeof sla !== "string") return FALLBACK_ETA[method] || "Varies by destination";
    switch (sla.toUpperCase()) {
      case "INSTANT":            return "Within minutes";
      case "THIRTY_MINUTES":     return "Within ~30 minutes";
      case "ONE_HOUR":           return "Within the hour";
      case "SAME_DAY":           return "Same day, most locations";
      case "ONE_BUSINESS_DAY":   return "1 business day";
      case "TWO_BUSINESS_DAYS":  return "1–2 business days";
      case "THREE_BUSINESS_DAYS":return "2–3 business days";
      case "FIVE_BUSINESS_DAYS": return "Up to 5 business days";
      default:
        return sla.toLowerCase().replace(/_/g, " ").replace(/^\w/, function (m) { return m.toUpperCase(); });
    }
  }

  /* ---------------------------------------------------------------------
     Fee display config.
     The fee shown in the widget is the REAL transfer fee from GET /quote.
     When that fee is $0.00 we render the waived treatment: a struck "standard"
     reference (display-only — the quote API returns no original fee when a fee
     is waived) beside a green $0.00. In illustrative fallback mode (no live
     quote) we show `demoFee`. Overridable via window.PAYMITTO_FEE.
     --------------------------------------------------------------------- */
  /* ---------------------------------------------------------------------
     Per-client widget config.
     popularDestinations: ISO3 codes surfaced in a "Popular destinations"
     group at the top of the destination dropdown. OPTIONAL — omit it or use
     an empty array to hide the group entirely. Codes the client isn't enabled
     for are ignored, so this can never offer an unsupported corridor.
     In the hosted widget this comes from the tenant's /config/{clientId}.json.
     --------------------------------------------------------------------- */
  var WIDGET = window.PAYMITTO_WIDGET || {
    popularDestinations: ["MEX", "IND", "PHL", "GTM", "COL"],
    // Analytics is per-client OPT-IN and off unless a tenant supplies a token.
    // Never commit a token here — set it from the tenant config / embed host.
    analytics: { enabled: false, token: "", clientId: null }
  };

  var FEE = window.PAYMITTO_FEE || {
    waivedStrike: 2.99, // "was" price struck through when the live fee is $0.00 (null = no strike)
    demoFee:      0     // fee shown in illustrative fallback (0 => showcases the waived $0.00 look)
  };

  /* ---------------------------------------------------------------------
     Analytics (Mixpanel) — per-client opt-in, anonymous, no third-party JS.

     Events POST straight to api.mixpanel.com/track, so the embedded widget's
     CSP only needs `connect-src https://api.mixpanel.com` — no script-src
     widening and no third-party script on a client's landing page.

     Off unless the tenant config both enables it AND supplies a token, and
     always off under Do-Not-Track / Global Privacy Control. The identifier is
     a per-session random id that is never persisted, so nothing is stored on
     the host page and there is no cross-site identity. No PII is ever sent.

     Event and property names mirror the PayMitto SDK taxonomy ("Screen -
     Action"; camelCase properties; amountToSend in cents) so this joins the
     existing funnels — notably RateWidget - Continue Tapped -> StartTransfer.
     --------------------------------------------------------------------- */
  var ANALYTICS = (WIDGET && WIDGET.analytics) || {};
  var MP_ENDPOINT = "https://api.mixpanel.com/track";

  function privacySignalOn() {
    try {
      return navigator.doNotTrack === "1" || window.doNotTrack === "1" ||
             navigator.msDoNotTrack === "1" || navigator.globalPrivacyControl === true;
    } catch (e) { return false; }
  }
  var trackingOn = !!(ANALYTICS.enabled && ANALYTICS.token) && !privacySignalOn();

  // The hosted widget gets its analytics config from the server (tenant config)
  // rather than the page, so no token ever lives in the repo. An explicit
  // window.PAYMITTO_WIDGET.analytics.token on the host page still wins.
  function applyAnalyticsConfig(cfg) {
    if (!cfg || (WIDGET.analytics && WIDGET.analytics.token)) return;
    ANALYTICS = cfg;
    trackingOn = !!(ANALYTICS.enabled && ANALYTICS.token) && !privacySignalOn();
  }

  // Anonymous, per-session only — deliberately not persisted.
  var sessionId = (function () {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return "s-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
  })();
  var trackSeq = 0;

  function track(event, props) {
    if (!trackingOn) return;
    var base = {
      token: ANALYTICS.token,
      distinct_id: sessionId,
      $insert_id: sessionId + "-" + (++trackSeq),
      time: Date.now(),
      client_id: ANALYTICS.clientId || null,
      surface: "rate-widget",
      srcCurrencyIso3Code: SRC_CCY
    };
    var p = props || {};
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k) && p[k] != null) base[k] = p[k];
    try {
      fetch(MP_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ event: event, properties: base }]),
        keepalive: true,
        mode: "cors"
      }).catch(function () {});
    } catch (e) { /* analytics must never break the widget */ }
  }

  // Corridor/amount context attached to most events.
  function trackCtx(extra) {
    var d = (typeof current === "function") ? current() : null;
    var send = els.amount ? parseAmount(els.amount.value) : 0;
    var o = {
      countryId: d ? d.iso3 : null,
      countryName: d ? d.name : null,
      dstCurrencyIso3Code: d ? d.ccy : null,
      transferMethod: method,
      amountToSend: Math.round(send * 100) // cents, matching the SDK
    };
    var e = extra || {};
    for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) o[k] = e[k];
    return o;
  }

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    calc:       document.querySelector(".calc"),
    amount:     $("send-amount"),
    country:    $("country"),
    receive:    $("receive-amount"),
    receiveCcy: $("receive-ccy"),
    rateLine:   $("rate-line"),
    etaLine:    $("eta-line"),
    feeLine:    $("fee-line"),
    footnote:   $("calc-footnote"),
    methodsWrap:document.querySelector(".calc__methods")
  };

  // Rate-disclosure copy: honest about whether numbers are live or illustrative.
  var FOOTNOTE_LIVE = "Live indicative rate. The exact amount is confirmed before you send.";
  var FOOTNOTE_DEMO = "Illustrative rates for demonstration only.";
  function setFootnote(isLive) {
    if (els.footnote) els.footnote.textContent = isLive ? FOOTNOTE_LIVE : FOOTNOTE_DEMO;
  }

  if (!els.country || !els.amount) return; // no calculator on this page

  var SRC_CCY = "USD";
  var destinations = [];   // active list: [{ name, iso3, ccy, dp, methods:[] }]
  var live = false;        // true once /api/corridors succeeds
  var method = "CASH_PICKUP";
  var lastValue = 0;
  var reqSeq = 0;          // guards against out-of-order quote responses
  var quoteTimer = null;

  /* ---------------------------------------------------------------------
     Formatting helpers
     --------------------------------------------------------------------- */
  function fmt(num, dp) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp
    }).format(num);
  }
  function parseAmount(raw) {
    var n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
    return isNaN(n) || n < 0 ? 0 : n;
  }
  function current() { return destinations[parseInt(els.country.value, 10) || 0]; }

  /* Smooth count-up to the new value. Falls back to snapping the final value if
     requestAnimationFrame never fires (reduced motion, or a hidden/backgrounded
     tab — e.g. an embedded preview browser) so the amount is never stuck on "—". */
  function animateTo(target, dp) {
    var start = lastValue;
    var delta = target - start;
    var duration = 450;
    var t0 = null;
    var done = false;
    lastValue = target;

    function settle() { if (!done) { done = true; els.receive.textContent = fmt(target, dp); } }

    if (!window.requestAnimationFrame ||
        (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      settle();
      return;
    }
    function frame(ts) {
      if (done) return;
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      els.receive.textContent = fmt(start + delta * eased, dp);
      if (p < 1) requestAnimationFrame(frame); else done = true;
    }
    requestAnimationFrame(frame);
    // Safety net: guarantee the final value renders even if RAF is throttled/frozen.
    setTimeout(settle, duration + 80);
  }

  function render(rate, receiveAmount, dp, ccy, etaLabel) {
    els.receiveCcy.textContent = ccy;
    // Show more precision for small rates (e.g. 1 USD = 0.7912 GBP), 2dp otherwise.
    els.rateLine.textContent = "1 " + SRC_CCY + " = " + fmt(rate, rate !== 0 && rate < 10 ? 4 : 2) + " " + ccy;
    els.etaLine.textContent = etaLabel;
    els.receive.classList.add("flash");
    setTimeout(function () { els.receive.classList.remove("flash"); }, 120);
    animateTo(receiveAmount, dp);
  }

  function setLoading(on) {
    if (els.calc) els.calc.classList.toggle("is-loading", !!on);
    els.receive.setAttribute("aria-busy", on ? "true" : "false");
  }

  // Neutral state when a live quote can't be shown. Live corridors carry no
  // illustrative rate, so we must NOT show a fabricated number under the live
  // label — show a dash and a message. `code` distinguishes a user-fixable
  // amount-range issue from a transient outage.
  function renderUnavailable(code) {
    var d = current();
    els.receive.textContent = "—";
    els.receiveCcy.textContent = d ? d.ccy : SRC_CCY;
    els.rateLine.textContent = /limit/i.test(code || "")
      ? "Amount is outside the allowed range for this destination"
      : "Rate temporarily unavailable";
    els.etaLine.textContent = slaText(null, method);
    renderFee(null);
  }

  /* ---------------------------------------------------------------------
     Fee display: live fee from the quote, with the promo overlaid.
     --------------------------------------------------------------------- */
  function money(v) { return "$" + fmt(v, 2); }

  // fee: the transfer fee to display (USD, major units) from GET /quote, or null
  // when unknown. feeOriginal: the pre-discount fee from the promotion endpoint
  // when a promo applies. A discount (feeOriginal > fee) — including a full
  // waiver to $0.00 — renders the promo treatment: the struck "was" + the
  // green discounted price. Any undiscounted fee renders plainly.
  function renderFee(fee, feeOriginal) {
    if (!els.feeLine) return;
    if (typeof fee !== "number") { els.feeLine.textContent = "—"; return; }
    // Prefer the real pre-discount fee; fall back to the demo strike only for a
    // fallback-mode $0 (no live quote, so no feeOriginal).
    var was = (typeof feeOriginal === "number" && feeOriginal > fee) ? feeOriginal
      : (fee === 0 && typeof FEE.waivedStrike === "number" && FEE.waivedStrike > 0 ? FEE.waivedStrike : null);
    // The fee is charged in the SOURCE currency — label it (e.g. "$0.00 USD"),
    // matching how the receive amount carries its currency. SRC_CCY comes from
    // our own API, but guard its shape before it touches innerHTML.
    var ccy = /^[A-Z]{3}$/.test(SRC_CCY) ? SRC_CCY : "USD";
    var ccyHtml = '<span class="fee-ccy"> ' + ccy + '</span>';
    if (was != null && was > fee) {
      els.feeLine.innerHTML =
        '<span class="was">' + money(was) + '</span>' +
        '<span class="free">' + money(fee) + '</span>' + ccyHtml;
    } else {
      els.feeLine.innerHTML = money(fee) + ccyHtml;
    }
  }

  /* ---------------------------------------------------------------------
     Populate the destination dropdown and delivery-method buttons
     --------------------------------------------------------------------- */
  function populateCountries() {
    els.country.innerHTML = "";
    destinations.forEach(function (d, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = flagF1(d) + "  " + d.name + " (" + d.ccy + ")";
      els.country.appendChild(opt);
    });
    comboSync();
  }

  /* ---------------------------------------------------------------------
     Destination combobox — a searchable dropdown over `destinations`.
     The native <select> stays the source of truth (so the rest of the widget
     is unchanged); this is the accessible UI layered on top, and unlike a
     native popup it renders reliably inside an iframe / embedded browser.
     --------------------------------------------------------------------- */
  var combo = {
    root:    $("country-combo"),
    trigger: $("country-trigger"),
    panel:   $("country-panel"),
    search:  $("country-search"),
    list:    $("country-listbox"),
    empty:   $("country-empty"),
    status:  $("country-status"),
    flag:    $("country-flag"),
    valueEl: $("country-value")
  };
  var comboRows = [];
  var comboActive = -1;
  var lastEmptyQuery = null;   // dedupes the empty-search event
  // Seeded from the initial field value: the default amount is not a user
  // edit, so the first auto-quote must not emit an "Updated" event.
  var lastTrackedAmount = null;
  var CHECK_SVG = '<svg class="check" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function comboIsOpen() { return !!combo.root && combo.root.getAttribute("data-open") === "true"; }
  function comboSelectedIndex() { return parseInt(els.country.value, 10) || 0; }

  // "Popular destinations" for this client: config order, intersected with the
  // destinations actually available — so it can never offer an unsupported one.
  function popularIndexes() {
    var codes = (WIDGET && WIDGET.popularDestinations) || [];
    var out = [];
    codes.forEach(function (iso) {
      var i = destinations.findIndex(function (d) { return d.iso3 === iso; });
      if (i !== -1 && out.indexOf(i) === -1) out.push(i);
    });
    return out;
  }
  function comboMatch(d, q) {
    return !q || (d.name + " " + d.ccy + " " + d.iso3).toLowerCase().indexOf(q) !== -1;
  }

  function comboRender(query) {
    if (!combo.list) return;
    var q = (query || "").trim().toLowerCase();
    var selected = comboSelectedIndex();
    var used = {};
    var html = "";

    function rowHtml(i) {
      var d = destinations[i];
      var isSel = i === selected;
      return '<li class="combo__opt" role="option" id="dest-opt-' + i + '" data-index="' + i + '"' +
             ' aria-selected="' + (isSel ? "true" : "false") + '">' +
               '<span class="flag" aria-hidden="true">' + flagF1(d) + '</span>' +
               '<span class="name">' + esc(d.name) + '</span>' +
               '<span class="code">' + esc(d.ccy) + '</span>' +
               (isSel ? CHECK_SVG : "") +
             '</li>';
    }

    // A real role="group" that OWNS its options, so the section name is
    // announced. The visible heading is aria-hidden — the group's label
    // carries it, and a bare <li> header would otherwise be an invalid child
    // of the listbox.
    function section(label, idxs) {
      return '<li role="group" aria-label="' + esc(label) + '">' +
               '<div class="combo__group" aria-hidden="true">' + esc(label) + '</div>' +
               '<ul class="combo__group-list" role="none">' + idxs.map(rowHtml).join("") + '</ul>' +
             '</li>';
    }

    var pop = popularIndexes().filter(function (i) { return comboMatch(destinations[i], q); });
    pop.forEach(function (i) { used[i] = true; });
    var rest = [];
    destinations.forEach(function (d, i) { if (!used[i] && comboMatch(d, q)) rest.push(i); });

    if (pop.length) {
      html += section("Popular destinations", pop);
      if (rest.length) html += section("All destinations", rest);
    } else {
      html += rest.map(rowHtml).join("");
    }

    combo.list.innerHTML = html;
    var count = pop.length + rest.length;
    if (combo.empty) combo.empty.hidden = count > 0;
    if (count > 0) { lastEmptyQuery = null; }
    else if (q.length >= 2 && q !== lastEmptyQuery) {
      lastEmptyQuery = q;
      // Sanitised: letters/spaces only, capped — enough to learn which
      // destinations people want, without capturing arbitrary typed input.
      track("RateWidget - Country searched with empty result",
            { searchTerm: q.replace(/[^a-z ]/g, "").slice(0, 32) });
    }
    comboRows = [].slice.call(combo.list.querySelectorAll(".combo__opt"));

    // Always keep an option active: the selected one if it survived the filter,
    // otherwise the first match — else Enter would be a dead key.
    var want = comboRows.findIndex(function (el) { return Number(el.getAttribute("data-index")) === selected; });
    comboSetActive(comboRows.length ? (want === -1 ? 0 : want) : -1);

    // aria-expanded describes whether a popup of options is showing.
    if (combo.search) combo.search.setAttribute("aria-expanded", count > 0 ? "true" : "false");
    if (combo.status) {
      combo.status.textContent = count === 0
        ? "No destinations match that search."
        : q
          ? count + (count === 1 ? " destination matches that search." : " destinations match that search.")
          : count + (count === 1 ? " destination available." : " destinations available.");
    }
  }

  function comboSetActive(i) {
    comboActive = i;
    comboRows.forEach(function (el, n) { el.classList.toggle("is-active", n === i); });
    var el = comboRows[i];
    if (el && combo.search) {
      combo.search.setAttribute("aria-activedescendant", el.id);
      if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    } else if (combo.search) {
      combo.search.removeAttribute("aria-activedescendant");
    }
  }

  function comboSync() {
    if (!combo.valueEl) return;
    var d = destinations[comboSelectedIndex()];
    if (combo.flag) combo.flag.textContent = d ? flagF1(d) : "🌐";
    combo.valueEl.textContent = d ? (d.name + " (" + d.ccy + ")") : "Select a destination";
    if (comboIsOpen()) comboRender(combo.search ? combo.search.value : "");
  }

  function comboOpen() {
    if (!combo.root) return;
    combo.root.setAttribute("data-open", "true");
    combo.trigger.setAttribute("aria-expanded", "true");
    track("RateWidget - CountryDropdown Tapped", trackCtx());
    combo.panel.hidden = false;
    if (combo.search) combo.search.value = "";
    comboRender("");
    // On touch, don't auto-focus the field: it summons the on-screen keyboard
    // over an already-short list. Tapping the field still filters.
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (combo.search && !coarse) combo.search.focus();
  }
  function comboClose(refocus) {
    if (!combo.root) return;
    combo.root.setAttribute("data-open", "false");
    combo.trigger.setAttribute("aria-expanded", "false");
    if (combo.search) combo.search.setAttribute("aria-expanded", "false");
    combo.panel.hidden = true;
    if (refocus && combo.trigger) combo.trigger.focus();
  }
  function comboChoose(index) {
    if (!destinations[index]) return;
    els.country.value = String(index);
    els.country.dispatchEvent(new Event("change", { bubbles: true }));
    track("RateWidget - Country Selected", trackCtx());
    comboClose(true);
  }

  if (combo.root && combo.trigger && combo.list) {
    combo.root.classList.add("combo--ready"); // swap native select -> combobox
    combo.root.setAttribute("data-open", "false");

    combo.trigger.addEventListener("click", function () {
      if (comboIsOpen()) comboClose(true); else comboOpen();
    });
    combo.trigger.addEventListener("keydown", function (e) {
      // ArrowUp opens too (APG) — otherwise it just scrolls the page.
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault(); comboOpen();
      }
    });

    if (combo.search) {
      combo.search.addEventListener("input", function () { comboRender(combo.search.value); });
      combo.search.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown")      { e.preventDefault(); comboSetActive(Math.min(comboActive + 1, comboRows.length - 1)); }
        else if (e.key === "ArrowUp")   { e.preventDefault(); comboSetActive(Math.max(comboActive - 1, 0)); }
        else if (e.key === "Home")      { e.preventDefault(); comboSetActive(0); }
        else if (e.key === "End")       { e.preventDefault(); comboSetActive(comboRows.length - 1); }
        else if (e.key === "Enter")     {
          e.preventDefault();
          var el = comboRows[comboActive];
          if (el) comboChoose(Number(el.getAttribute("data-index")));
        }
        else if (e.key === "Escape")    { e.preventDefault(); comboClose(true); }
        else if (e.key === "Tab")       { comboClose(false); }
      });
    }

    combo.list.addEventListener("click", function (e) {
      var el = e.target && e.target.closest ? e.target.closest(".combo__opt") : null;
      if (el) comboChoose(Number(el.getAttribute("data-index")));
    });
    combo.list.addEventListener("mousemove", function (e) {
      var el = e.target && e.target.closest ? e.target.closest(".combo__opt") : null;
      if (el) comboSetActive(comboRows.indexOf(el));
    });
    // Dismiss on outside interaction. pointerdown as well as click, because
    // iOS Safari doesn't synthesize click for taps on non-interactive elements.
    var dismiss = function (e) {
      if (comboIsOpen() && !combo.root.contains(e.target)) comboClose(false);
    };
    document.addEventListener("click", dismiss);
    document.addEventListener("pointerdown", dismiss);
  }

  function renderMethods() {
    if (!els.methodsWrap) return;
    var d = current();
    var methods = (d && d.methods && d.methods.length) ? d.methods : FALLBACK_METHODS;
    if (methods.indexOf(method) === -1) method = methods[0];

    els.methodsWrap.innerHTML = "";
    methods.forEach(function (m) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-method", m);
      btn.textContent = METHOD_LABELS[m] || m;
      if (m === method) btn.classList.add("active");
      // Exclusive choice rendered as toggle buttons: aria-pressed is what makes
      // the selected method perceivable to assistive tech (a CSS class isn't).
      btn.setAttribute("aria-pressed", m === method ? "true" : "false");
      btn.addEventListener("click", function () {
        method = m;
        // Selecting a tile marked unavailable is a retry: clear the mark first.
        setMethodFailed(current(), m, false);
        els.methodsWrap.querySelectorAll("button").forEach(function (b) {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        track("RateWidget - Method Selected", trackCtx());
        requestQuote(true);
      });
      els.methodsWrap.appendChild(btn);
    });
    updateMethodStates();
  }

  /* ---------------------------------------------------------------------
     Per-corridor method availability.
     A delivery method can fail for a corridor (the upstream can be down for a
     whole method). We mark that tile "unavailable" rather than leaving the user
     staring at an error with no idea which method works. Purely transient UI
     state: selecting the tile retries it and a success clears the mark, so it
     self-heals the moment the upstream method recovers.
     --------------------------------------------------------------------- */
  var methodFailures = {};
  function failKey(d, m) { return (d ? d.iso3 : "?") + "|" + m; }
  function isMethodFailed(d, m) { return !!methodFailures[failKey(d, m)]; }
  function setMethodFailed(d, m, failed) {
    if (!d) return false;
    var k = failKey(d, m), had = !!methodFailures[k];
    if (failed) methodFailures[k] = true; else delete methodFailures[k];
    return had !== failed;
  }
  function updateMethodStates() {
    if (!els.methodsWrap) return;
    var d = current();
    els.methodsWrap.querySelectorAll("button").forEach(function (b) {
      var m = b.getAttribute("data-method");
      var label = METHOD_LABELS[m] || m;
      var failed = isMethodFailed(d, m);
      b.classList.toggle("is-unavailable", failed);
      // Keep it enabled (selecting retries), so convey the state in the name
      // rather than with aria-disabled, which would imply it isn't actionable.
      if (failed) b.setAttribute("aria-label", label + " — currently unavailable for this destination, select to retry");
      else b.removeAttribute("aria-label");
    });
  }

  /* ---------------------------------------------------------------------
     Quote resolution: live API first, silent fallback to illustrative math
     --------------------------------------------------------------------- */
  function fallbackQuote() {
    var d = current();
    var send = parseAmount(els.amount.value);
    // Fallback rows carry a rate; live rows converted to fallback won't — guard.
    var rate = typeof d.rate === "number" ? d.rate : 0;
    render(rate, send * rate, d.dp, d.ccy, FALLBACK_ETA[method] || slaText(null, method));
    renderFee(typeof FEE.demoFee === "number" ? FEE.demoFee : null);
  }

  function requestQuote(immediate) {
    if (!live) { fallbackQuote(); return; }

    var run = function () {
      var d = current();
      var send = parseAmount(els.amount.value);
      if (!d || send <= 0) {
        render(0, 0, d ? d.dp : 2, d ? d.ccy : SRC_CCY, slaText(null, method));
        renderFee(null);
        return;
      }

      var amountMinor = Math.round(send * 100); // USD source, 2 dp
      if (amountMinor !== lastTrackedAmount) {
        lastTrackedAmount = amountMinor;
        track("RateWidget - AmountToSendField Updated", trackCtx());
      }
      var seq = ++reqSeq;
      setLoading(true);

      var qs = new URLSearchParams({
        srcCurrencyIso3Code: SRC_CCY,
        dstCountryIso3Code:  d.iso3,
        dstCurrencyIso3Code: d.ccy,
        transferMethod:      method,
        quoteBy:             "SEND_AMOUNT",
        amount:              String(amountMinor)
      });

      fetch("/api/quote?" + qs.toString(), { headers: { accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (q) {
          if (seq !== reqSeq) return;          // a newer request superseded this
          setLoading(false);
          if (!q || q.unavailable) {
            var code = q && q.code;
            // An amount-range error is fixed by changing the amount, not the
            // method — only mark the tile for genuine method failures.
            if (!/limit/i.test(code || "") && setMethodFailed(d, method, true)) updateMethodStates();
            track("RateWidget - Quote Unavailable", trackCtx({ reasonCode: code || "unknown" }));
            renderUnavailable(code);
            return;
          }
          if (setMethodFailed(d, method, false)) updateMethodStates();
          render(q.rate, q.receiveAmount, q.receiveDecimals, q.receiveCurrency, slaText(q.deliverySLA, method));
          renderFee(typeof q.fee === "number" ? q.fee : null,
                    typeof q.feeOriginal === "number" ? q.feeOriginal : undefined);
          track("RateWidget - Quote Selected", trackCtx({
            amountToReceive: (typeof q.receiveAmount === "number")
              ? Math.round(q.receiveAmount * Math.pow(10, q.receiveDecimals || 0)) : null,
            rate: q.rate,
            fee: (typeof q.fee === "number") ? Math.round(q.fee * 100) : null,
            quoteHistoryId: q.quoteHistoryId || null
          }));
        })
        .catch(function (err) {
          if (seq !== reqSeq) return;
          setLoading(false);
          // Surface the real reason in the console: this catch also sees render
          // errors, and a render bug must not masquerade as an API outage.
          if (window.console && console.error) console.error("quote failed:", err);
          // Silent fallback: keep the last good live value if we have one;
          // otherwise show a neutral unavailable state (never a fake 0).
          if (lastValue <= 0) renderUnavailable();
        });
    };

    if (quoteTimer) { clearTimeout(quoteTimer); quoteTimer = null; }
    if (immediate) run();
    else quoteTimer = setTimeout(run, 350);
  }

  /* ---------------------------------------------------------------------
     Wire inputs
     --------------------------------------------------------------------- */
  els.amount.addEventListener("input", function () { requestQuote(false); });
  els.amount.addEventListener("blur", function () {
    var n = parseAmount(els.amount.value);
    els.amount.value = n ? fmt(n, 0) : "";
  });
  els.amount.addEventListener("focus", function () {
    els.amount.value = String(parseAmount(els.amount.value) || "");
  });
  var ctaEl = document.querySelector(".calc .btn--primary");
  if (ctaEl) {
    ctaEl.addEventListener("click", function () {
      track("RateWidget - Continue Tapped", trackCtx());
    });
  }

  els.country.addEventListener("change", function () {
    comboSync();
    renderMethods();
    requestQuote(true);
  });

  /* ---------------------------------------------------------------------
     Boot: try live corridors, else fall back to the illustrative table
     --------------------------------------------------------------------- */
  function startFallback() {
    live = false;
    setFootnote(false);
    destinations = FALLBACK.map(function (d) {
      return { name: d.name, iso3: d.iso3, ccy: d.ccy, dp: d.dp, rate: d.rate, methods: FALLBACK_METHODS.slice() };
    });
    populateCountries();
    renderMethods();
    requestQuote(true);
  }

  // Float popular US remittance corridors to the top so the live dropdown
  // doesn't default to an alphabetical-first exotic corridor. The rest keep the
  // server's alphabetical order.
  var PREFERRED_ISO3 = ["MEX", "IND", "PHL", "COL", "NGA", "GTM", "HND", "DOM", "SLV", "ECU", "KEN", "VNM", "BRA"];
  function orderDestinations(list) {
    var pref = [];
    PREFERRED_ISO3.forEach(function (iso) {
      var i = list.findIndex(function (d) { return d.iso3 === iso; });
      if (i !== -1) pref.push(list.splice(i, 1)[0]);
    });
    return pref.concat(list);
  }

  function startLive(corridors) {
    live = true;
    setFootnote(true);
    destinations = orderDestinations(corridors.map(function (c) {
      return {
        name:   c.name,
        iso3:   c.countryIso3,
        iso2:   c.countryIso2,
        ccy:    c.currencyIso3,
        dp:     typeof c.decimalPlaces === "number" ? c.decimalPlaces : 2,
        methods:(c.methods && c.methods.length) ? c.methods : FALLBACK_METHODS.slice()
      };
    }));
    populateCountries();
    renderMethods();
    requestQuote(true);
  }

  lastTrackedAmount = els.amount ? Math.round(parseAmount(els.amount.value) * 100) : null;

  fetch("/api/corridors", { headers: { accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (data) {
      if (data && Array.isArray(data.corridors) && data.corridors.length) {
        if (data.srcCurrency) SRC_CCY = data.srcCurrency;
        applyAnalyticsConfig(data.analytics);
        track("RateWidget - Viewed", { mode: "live", destinationCount: data.corridors.length });
        startLive(data.corridors);
      } else {
        track("RateWidget - Viewed", { mode: "illustrative", destinationCount: FALLBACK.length });
        startFallback();
      }
    })
    .catch(function () {
      track("RateWidget - Viewed", { mode: "illustrative", destinationCount: FALLBACK.length });
      startFallback();
    });

  /* ---------------------------------------------------------------------
     Promo ribbon dismiss
     --------------------------------------------------------------------- */
  var ribbon = $("ribbon");
  var ribbonClose = $("ribbon-close");
  if (ribbonClose && ribbon) {
    ribbonClose.addEventListener("click", function () { ribbon.remove(); });
  }

  /* ---------------------------------------------------------------------
     Mobile nav
     --------------------------------------------------------------------- */
  var nav = $("nav");
  var navToggle = $("nav-toggle");
  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll(".nav__links a, .nav__actions a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------------------------------------------------------------------
     Reveal on scroll
     --------------------------------------------------------------------- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }
})();
