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
    popularDestinations: ["MEX", "IND", "PHL", "GTM", "COL"]
  };

  var FEE = window.PAYMITTO_FEE || {
    waivedStrike: 2.99, // "was" price struck through when the live fee is $0.00 (null = no strike)
    demoFee:      0     // fee shown in illustrative fallback (0 => showcases the waived $0.00 look)
  };

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
    flag:    $("country-flag"),
    valueEl: $("country-value")
  };
  var comboRows = [];
  var comboActive = -1;
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

    var pop = popularIndexes().filter(function (i) { return comboMatch(destinations[i], q); });
    if (pop.length) {
      html += '<li class="combo__group" role="presentation">Popular destinations</li>';
      pop.forEach(function (i) { html += rowHtml(i); used[i] = true; });
    }
    var rest = [];
    destinations.forEach(function (d, i) { if (!used[i] && comboMatch(d, q)) rest.push(i); });
    if (rest.length) {
      if (pop.length) html += '<li class="combo__group" role="presentation">All destinations</li>';
      rest.forEach(function (i) { html += rowHtml(i); });
    }

    combo.list.innerHTML = html;
    if (combo.empty) combo.empty.hidden = (pop.length + rest.length) > 0;
    comboRows = [].slice.call(combo.list.querySelectorAll(".combo__opt"));
    comboSetActive(comboRows.findIndex(function (el) { return Number(el.getAttribute("data-index")) === selected; }));
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
    combo.panel.hidden = false;
    if (combo.search) combo.search.value = "";
    comboRender("");
    if (combo.search) combo.search.focus();
  }
  function comboClose(refocus) {
    if (!combo.root) return;
    combo.root.setAttribute("data-open", "false");
    combo.trigger.setAttribute("aria-expanded", "false");
    combo.panel.hidden = true;
    if (refocus && combo.trigger) combo.trigger.focus();
  }
  function comboChoose(index) {
    if (!destinations[index]) return;
    els.country.value = String(index);
    els.country.dispatchEvent(new Event("change", { bubbles: true }));
    comboClose(true);
  }

  if (combo.root && combo.trigger && combo.list) {
    combo.root.classList.add("combo--ready"); // swap native select -> combobox
    combo.root.setAttribute("data-open", "false");

    combo.trigger.addEventListener("click", function () {
      if (comboIsOpen()) comboClose(true); else comboOpen();
    });
    combo.trigger.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); comboOpen(); }
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
    document.addEventListener("click", function (e) {
      if (comboIsOpen() && !combo.root.contains(e.target)) comboClose(false);
    });
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
      btn.addEventListener("click", function () {
        method = m;
        els.methodsWrap.querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        requestQuote(true);
      });
      els.methodsWrap.appendChild(btn);
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
          if (!q || q.unavailable) { renderUnavailable(q && q.code); return; }
          render(q.rate, q.receiveAmount, q.receiveDecimals, q.receiveCurrency, slaText(q.deliverySLA, method));
          renderFee(typeof q.fee === "number" ? q.fee : null,
                    typeof q.feeOriginal === "number" ? q.feeOriginal : undefined);
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

  fetch("/api/corridors", { headers: { accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (data) {
      if (data && Array.isArray(data.corridors) && data.corridors.length) {
        if (data.srcCurrency) SRC_CCY = data.srcCurrency;
        startLive(data.corridors);
      } else {
        startFallback();
      }
    })
    .catch(startFallback);

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
