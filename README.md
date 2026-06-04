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

## Run locally
Static site — no build step.

```bash
python3 -m http.server 4317
# Concept A: http://localhost:4317/
# Concept B: http://localhost:4317/keystone/
```

## Structure
```
index.html              Concept A — Riverstone Credit Union (Mitto)
styles.css              Shared PayMitto design system + layout
app.js                  Shared logic: rate calculator, nav, FAQ, scroll reveal
keystone/
  index.html            Concept B — Keystone Bank (GlobalSend)
  keystone-theme.css    Concept B theme layer (premium / Meridian / squared)
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
