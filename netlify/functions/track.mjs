/* ==========================================================================
   POST /api/track

   Analytics relay. The Mixpanel project token stays on the server.

   It used to ride to the browser inside GET /api/corridors — a public,
   unauthenticated, `cache-control: public, max-age=300` response — so anyone
   could curl the corridor list and read the token straight out of it, without
   ever loading the widget. A Mixpanel project token is write-only and is
   client-side by design, so this is a data-integrity problem rather than a
   confidentiality one: nobody can read analytics with it, but anyone could
   write to them. The widget's case rests on its usage numbers, and those
   numbers were trivially poisonable.

   Events are allowlisted. A relay that forwards any event name it is handed is
   still an open relay — it just costs one extra request to discover.

   Side effect worth knowing: Mixpanel now sees THIS function's IP rather than
   the visitor's, so the per-event geo it used to infer is gone. That is a
   privacy improvement and an analytics regression at the same time; if geo
   matters, it has to be derived deliberately rather than as a side effect of
   the browser calling Mixpanel directly.
   ========================================================================== */
import { json } from "./_readyremit.mjs";
import { clientIp, rateLimit } from "./_util.mjs";

const MP_TOKEN    = process.env.MIXPANEL_TOKEN || "";
const MP_CLIENT   = process.env.MIXPANEL_CLIENT_ID || null;
// verbose=1 matters: the plain endpoint answers HTTP 200 with a body of "0"
// when it REJECTS an event (bad token, malformed payload), so res.ok alone
// would report a silently-dead analytics pipeline as healthy. verbose=1
// returns {status:1} or {status:0,error:"..."} so a rejection is loggable.
const MP_ENDPOINT = "https://api.mixpanel.com/track?verbose=1";

// Looser than /api/quote (60/min) because a single session legitimately fires
// several events per interaction — a visitor typing an amount and switching
// methods can emit a dozen in a few seconds.
const RL_LIMIT = 120, RL_WINDOW = 60 * 1000;

// The closed set the widget actually emits. Keep in step with the track()
// calls in app.js; an event missing here is silently dropped, which is the
// correct failure direction for analytics.
const ALLOWED_EVENTS = new Set([
  "RateWidget - Viewed",
  "RateWidget - AmountToSendField Updated",
  "RateWidget - CountryDropdown Tapped",
  "RateWidget - Country Selected",
  "RateWidget - Country searched with empty result",
  "RateWidget - Method Selected",
  "RateWidget - Quote Selected",
  "RateWidget - Quote Unavailable",
  "RateWidget - Continue Tapped"
]);

const MAX_PROPS = 40;
const MAX_KEY   = 40;
const MAX_STR   = 200;
const KEY_OK    = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Primitives only, bounded in count and length. Objects and arrays are
 *  dropped rather than walked: nothing the widget sends needs them, and
 *  refusing them keeps this from becoming an arbitrary-payload pipe. */
function cleanProps(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (n >= MAX_PROPS) break;
    if (k.length > MAX_KEY || !KEY_OK.test(k)) continue;
    const v = raw[k];
    if (v == null) continue;
    if (typeof v === "number") { if (Number.isFinite(v)) { out[k] = v; n++; } continue; }
    if (typeof v === "boolean") { out[k] = v; n++; continue; }
    if (typeof v === "string") { out[k] = v.slice(0, MAX_STR); n++; }
  }
  return out;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const rl = rateLimit(`track:${clientIp(req)}`, RL_LIMIT, RL_WINDOW);
  if (!rl.ok) return json(429, { error: "rate_limited" }, { "retry-after": String(rl.retryAfter) });

  // No token configured means analytics is off for this deployment. Answer
  // exactly as a successful relay would, so the browser cannot tell the
  // difference and no caller can probe the configuration.
  if (!MP_TOKEN) return new Response(null, { status: 204 });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "bad_request" }); }

  const event = body && body.event;
  if (typeof event !== "string" || !ALLOWED_EVENTS.has(event)) {
    // 204 rather than 400 on purpose: a prober learns nothing about which
    // event names are accepted.
    return new Response(null, { status: 204 });
  }

  const props = cleanProps(body.properties);
  const did = typeof body.distinct_id === "string" ? body.distinct_id.slice(0, 64) : "";

  // Server-owned fields are applied AFTER the client's, so a caller cannot
  // forge the token, the tenant or the surface by sending them as properties.
  const properties = {
    ...props,
    token:       MP_TOKEN,
    distinct_id: did || "anon",
    time:        Date.now(),
    client_id:   MP_CLIENT || props.client_id || null,
    surface:     "rate-widget"
  };

  try {
    const res = await fetch(MP_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ event, properties }])
    });
    const text = await res.text();
    let accepted = res.ok;
    if (accepted) {
      try { accepted = JSON.parse(text).status === 1; }
      catch { accepted = text.trim() === "1"; }   // non-verbose fallback
    }
    if (!accepted) console.error("track relay rejected:", res.status, text.slice(0, 200));
  } catch (e) {
    console.error("track relay failed:", e && e.message ? e.message : e);
  }

  // Always 204, whatever happened upstream. The browser must never learn
  // whether the relay succeeded, and analytics must never affect the widget.
  return new Response(null, { status: 204 });
};
