/* ==========================================================================
   Horizon demo — interactivity
   Rate calculator, mobile nav, promo ribbon, scroll reveal.
   Note: all rates are illustrative and for demonstration only.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     Illustrative FX data (1 USD = rate). Not real-time quotes.
     --------------------------------------------------------------------- */
  var COUNTRIES = [
    { name: "Mexico",            flag: "🇲🇽", ccy: "MXN", rate: 17.15,  dp: 2 },
    { name: "India",             flag: "🇮🇳", ccy: "INR", rate: 83.30,  dp: 2 },
    { name: "Philippines",       flag: "🇵🇭", ccy: "PHP", rate: 56.40,  dp: 2 },
    { name: "Guatemala",         flag: "🇬🇹", ccy: "GTQ", rate: 7.78,   dp: 2 },
    { name: "Honduras",          flag: "🇭🇳", ccy: "HNL", rate: 24.70,  dp: 2 },
    { name: "Colombia",          flag: "🇨🇴", ccy: "COP", rate: 3955,   dp: 0 },
    { name: "Nigeria",           flag: "🇳🇬", ccy: "NGN", rate: 1485,   dp: 0 },
    { name: "Vietnam",           flag: "🇻🇳", ccy: "VND", rate: 24550,  dp: 0 },
    { name: "Kenya",             flag: "🇰🇪", ccy: "KES", rate: 129.5,  dp: 0 },
    { name: "Canada",            flag: "🇨🇦", ccy: "CAD", rate: 1.36,   dp: 2 },
    { name: "United Kingdom",    flag: "🇬🇧", ccy: "GBP", rate: 0.79,   dp: 2 },
    { name: "Germany (Euro)",    flag: "🇩🇪", ccy: "EUR", rate: 0.92,   dp: 2 },
    { name: "Brazil",            flag: "🇧🇷", ccy: "BRL", rate: 4.97,   dp: 2 }
  ];

  var ETA = {
    bank:  "1–2 business days",
    debit: "Within minutes",
    cash:  "Same day, most locations"
  };

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    amount:    $("send-amount"),
    country:   $("country"),
    receive:   $("receive-amount"),
    receiveCcy:$("receive-ccy"),
    rateLine:  $("rate-line"),
    etaLine:   $("eta-line"),
    methods:   document.querySelectorAll(".calc__methods button")
  };

  var method = "cash";
  var lastValue = 0;

  /* ---------------------------------------------------------------------
     Populate destination dropdown
     --------------------------------------------------------------------- */
  if (els.country) {
    COUNTRIES.forEach(function (c, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = c.flag + "  " + c.name + " (" + c.ccy + ")";
      els.country.appendChild(opt);
    });
  }

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

  function recalc() {
    if (!els.country) return;
    var c = COUNTRIES[parseInt(els.country.value, 10) || 0];
    var send = parseAmount(els.amount.value);
    var received = send * c.rate;

    els.receiveCcy.textContent = c.ccy;
    els.rateLine.textContent = "1 USD = " + fmt(c.rate, c.dp === 0 ? 0 : 2) + " " + c.ccy;
    els.etaLine.textContent = ETA[method];

    els.receive.classList.add("flash");
    setTimeout(function () { els.receive.classList.remove("flash"); }, 120);
    animateTo(received, c.dp);
  }

  if (els.amount) {
    els.amount.addEventListener("input", recalc);
    els.amount.addEventListener("blur", function () {
      var n = parseAmount(els.amount.value);
      els.amount.value = n ? fmt(n, 0) : "";
    });
    els.amount.addEventListener("focus", function () {
      els.amount.value = String(parseAmount(els.amount.value) || "");
    });
  }
  if (els.country) els.country.addEventListener("change", recalc);

  els.methods.forEach(function (btn) {
    btn.addEventListener("click", function () {
      els.methods.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      method = btn.getAttribute("data-method");
      els.etaLine.textContent = ETA[method];
    });
  });

  // First paint
  recalc();

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
