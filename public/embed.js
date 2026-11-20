/* ==========================================================================
   PayMitto Global Transfers — one-line embed loader.

   A client drops this on their page:

     <script src="https://widget.example.com/embed.js"
             data-client="keystone" data-amount="100" async></script>

   It inserts the widget iframe in place and keeps its height in sync. Clients
   who can't add a script (strict CSP) can paste the <iframe> + listener
   snippet instead — see embed-example.html.
   ========================================================================== */
(function () {
  var me = document.currentScript || (function () {
    var all = document.querySelectorAll('script[src*="embed.js"]');
    return all[all.length - 1];
  })();
  if (!me || me.dataset.pmLoaded) return;
  me.dataset.pmLoaded = "1";

  // Resolve embed.html next to this script, so the widget works whether the
  // site is served from a domain root (Netlify) or a subpath (GitHub Pages).
  var origin, frameUrl;
  try {
    frameUrl = new URL("embed.html", new URL(me.src, location.href));
    origin = frameUrl.origin;
  } catch (e) { return; }

  var d = me.dataset || {};
  var qs = new URLSearchParams();
  ["client", "theme", "corridor", "amount", "src", "lang"].forEach(function (k) {
    if (d[k]) qs.set(k, d[k]);
  });

  var frame = document.createElement("iframe");
  frameUrl.search = qs.toString();
  frame.src = frameUrl.href;
  frame.title = "Global Transfers rate calculator";
  frame.loading = "lazy";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  // allow-top-navigation is deliberately omitted: the widget must never be
  // able to redirect the host page. The CTA opens in a new tab instead.
  frame.setAttribute("sandbox",
    "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  frame.style.cssText =
    "border:0;display:block;width:100%;max-width:" + (d.maxWidth || "480px") +
    ";min-height:" + (d.minHeight || "480px") + ";margin:" + (d.margin || "0");

  me.parentNode.insertBefore(frame, me);

  window.addEventListener("message", function (e) {
    // The real security gate: it must come from OUR origin and from THIS frame.
    if (e.origin !== origin) return;
    if (!frame.contentWindow || e.source !== frame.contentWindow) return;
    var m = e.data;
    if (!m || m.source !== "paymitto-widget" || m.type !== "resize") return;
    if (typeof m.height === "number" && m.height > 0 && m.height < 4000) {
      frame.style.height = m.height + "px";
    }
  });
})();
