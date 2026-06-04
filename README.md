# Horizon — Global Money Transfer (demo landing page)

A demonstration landing page showcasing the **PayMitto** global money-transfer
feature, built on the PayMitto design system.

It is framed as a fictional credit union — **Riverstone Credit Union** — offering
a global transfer service called **Horizon**, *Powered by PayMitto*. This mirrors
how a real financial-institution client would present the feature behind their own
brand, so it doubles as inspiration for prospective and current clients.

> ⚠️ **Demonstration only.** Riverstone Credit Union is a fictional institution.
> All rates, fees, figures, phone numbers, and routing details shown are
> illustrative and not real.

## Best-practice elements
- Interactive **"You send → they receive"** rate preview (amount, destination, delivery method)
- Clear three-step "How it works"
- Benefit pillars: fast delivery, transparent pricing, bank-grade security, no third-party apps, human support, global reach
- Story-driven "moments that matter" section
- Flexible delivery options (bank deposit / debit card / cash pickup) with timing
- Supported-countries grid, security section, and a deep FAQ
- Promo ribbon and a compliant footer (NCUA / FDIC, partner-bank and "Powered by PayMitto" disclosures)
- Fully responsive; PayMitto palette (Sunrise / Meridian) and type (Pathway Extreme + Karla)

## Run locally
This is a static site — there is no build step.

```bash
python3 -m http.server 4317
# then open http://localhost:4317
```

## Structure
- `index.html` — page structure and content
- `styles.css` — PayMitto design system + layout
- `app.js` — rate calculator, mobile nav, FAQ, scroll reveal
- `assets/` — PayMitto symbol marks

---
Built by PayMitto to illustrate landing-page best practices for the global transfer feature.
