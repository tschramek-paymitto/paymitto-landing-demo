/* Applies a concept theme inside the embed, from ?theme=.
   Allowlisted only — a tenant can never point this at an arbitrary stylesheet. */
(function () {
  var THEMES = { keystone: "keystone/keystone-theme.css" };
  try {
    var t = (new URLSearchParams(location.search).get("theme") || "")
              .replace(/[^a-z0-9-]/gi, "").toLowerCase();
    var href = THEMES[t];
    if (!href) return;
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href;
    document.head.appendChild(l);   // after styles.css, so it overrides
  } catch (e) {}
})();
