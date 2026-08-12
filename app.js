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

  // UI delivery method  <->  quote-API transferMethod enum.
  var METHOD_LABELS = {
    BANK_ACCOUNT:  "Bank deposit",
    PUSH_TO_CARD:  "Debit card",
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

  // Humanize a deliverySLA enum from a live quote.
  function slaText(sla, method) {
    if (!sla) return FALLBACK_ETA[method] || "Varies by destination";
    switch (sla) {
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
     Promotion overlay.
     The REAL fee always comes from the quote API. A promo is layered on top:
     the live fee is shown struck through and the promo price sits beside it.
     Nothing here fakes the fee — it only decides what the customer pays while
     the promo runs. A page can override any of this via window.PAYMITTO_PROMO.
     --------------------------------------------------------------------- */
  var PROMO = window.PAYMITTO_PROMO || {
    active:      true,
    endsOn:      "2026-08-31", // auto-expires after this date (viewer's clock)
    price:       0,            // what the customer pays during the promo (0 = waived)
    standardFee: 2.99,         // struck-through fee for the illustrative fallback only
    applies:     null          // optional fn(ctx {iso3, method, amount}) => boolean
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

  /* Smooth count-up to the new value */
  function animateTo(target, dp) {
    var start = lastValue;
    var delta = target - start;
    var duration = 450;
    var t0 = null;
    lastValue = target;

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      els.receive.textContent = fmt(target, dp);
      return;
    }
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      els.receive.textContent = fmt(start + delta * eased, dp);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function render(rate, receiveAmount, dp, ccy, etaLabel) {
    els.receiveCcy.textContent = ccy;
    els.rateLine.textContent = "1 " + SRC_CCY + " = " + fmt(rate, dp === 0 ? 2 : 2) + " " + ccy;
    els.etaLine.textContent = etaLabel;
    els.receive.classList.add("flash");
    setTimeout(function () { els.receive.classList.remove("flash"); }, 120);
    animateTo(receiveAmount, dp);
  }

  function setLoading(on) {
    if (els.calc) els.calc.classList.toggle("is-loading", !!on);
    els.receive.setAttribute("aria-busy", on ? "true" : "false");
  }

  // Neutral state for a transient live-quote failure. Live corridors carry no
  // illustrative rate, so we must NOT show a fabricated number under the live
  // label — show a dash and a gentle note instead.
  function renderUnavailable() {
    var d = current();
    els.receive.textContent = "—";
    els.receiveCcy.textContent = d ? d.ccy : SRC_CCY;
    els.rateLine.textContent = "Rate temporarily unavailable";
    els.etaLine.textContent = slaText(null, method);
    renderFee(null, { iso3: d ? d.iso3 : null, method: method, amount: 0 });
  }

  /* ---------------------------------------------------------------------
     Fee display: live fee from the quote, with the promo overlaid.
     --------------------------------------------------------------------- */
  function money(v) { return "$" + fmt(v, 2); }

  function promoActive() {
    if (!PROMO || !PROMO.active) return false;
    if (PROMO.endsOn) {
      var end = new Date(PROMO.endsOn + "T23:59:59");
      if (!isNaN(end.getTime()) && Date.now() > end.getTime()) return false;
    }
    return true;
  }
  function promoApplies(ctx) {
    if (!promoActive()) return false;
    if (typeof PROMO.applies === "function") {
      try { return !!PROMO.applies(ctx); } catch (e) { return false; }
    }
    return true;
  }

  // liveFee: real USD fee from the quote, or null when unknown (fallback path).
  function renderFee(liveFee, ctx) {
    if (!els.feeLine) return;
    var promoPrice = (PROMO && typeof PROMO.price === "number") ? PROMO.price : 0;
    var standard = (liveFee != null) ? liveFee
      : (PROMO && typeof PROMO.standardFee === "number" ? PROMO.standardFee : null);

    if (promoApplies(ctx) && standard != null && promoPrice < standard) {
      // Waived (or discounted): strike the real fee, show the promo price.
      els.feeLine.innerHTML =
        '<span class="was">' + money(standard) + '</span>' +
        '<span class="free">' + money(promoPrice) + '</span>';
    } else if (promoApplies(ctx) && standard == null) {
      // Promo on but no fee to strike — just show the promo price.
      els.feeLine.innerHTML = '<span class="free">' + money(promoPrice) + '</span>';
    } else if (standard != null) {
      // No promo: show the live fee plainly.
      els.feeLine.textContent = money(standard);
    } else {
      els.feeLine.textContent = "—";
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
      opt.textContent = flagFor(d.iso3) + "  " + d.name + " (" + d.ccy + ")";
      els.country.appendChild(opt);
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
    renderFee(null, { iso3: d.iso3, method: method, amount: send });
  }

  function requestQuote(immediate) {
    if (!live) { fallbackQuote(); return; }

    var run = function () {
      var d = current();
      var send = parseAmount(els.amount.value);
      if (!d || send <= 0) {
        render(0, 0, d ? d.dp : 2, d ? d.ccy : SRC_CCY, slaText(null, method));
        renderFee(null, { iso3: d ? d.iso3 : null, method: method, amount: 0 });
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
          render(q.rate, q.receiveAmount, q.receiveDecimals, q.receiveCurrency, slaText(q.deliverySLA, method));
          renderFee(typeof q.fee === "number" ? q.fee : null, { iso3: d.iso3, method: method, amount: send });
        })
        .catch(function () {
          if (seq !== reqSeq) return;
          setLoading(false);
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

  function startLive(corridors) {
    live = true;
    setFootnote(true);
    destinations = corridors.map(function (c) {
      return {
        name:   c.name,
        iso3:   c.countryIso3,
        ccy:    c.currencyIso3,
        dp:     typeof c.decimalPlaces === "number" ? c.decimalPlaces : 2,
        methods:(c.methods && c.methods.length) ? c.methods : FALLBACK_METHODS.slice()
      };
    });
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
